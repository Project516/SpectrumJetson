// JNI bridge between the FRC-Team-4143 PhotonVision fork (org.photonvision.jni.GpuDetectorJNI)
// and Austin Schuh's current CUDA AprilTag detector, as built in frc971/bos
// third_party/971apriltag (from RealtimeRoboticsGroup/aos frc/orin).
//
// Keeps the exact Java API of FRC-Team-4143/GpuDetectorJNI so the fork jar is unchanged:
//   long createGpuDetector(int width, int height)
//   void destroyGpuDetector(long handle)
//   void setparams(long handle, fx, cx, fy, cy, k1, k2, p1, p2, k3)
//   void setparams8(long handle, fx, cx, fy, cy, k1, k2, p1, p2, k3, k4, k5, k6)   // ours
//   AprilTagDetection[] processimage(long handle, long cvMatPtr)   // 8-bit mono Mat
//
// Differences from the 4143 JNI (see SpectrumJetson patches/gpudetector-0*.patch for the
// same fixes applied to the old code):
//   - detector slots are reused after destroy; every handle is bounds-checked
//   - detectors are freed with apriltag_detector_destroy / tag36h11_destroy
//   - a per-slot mutex stops destroy/setparams racing processimage
//   - stale CUDA errors are cleared before each detect (NVIDIA/cccl#1791)
//   - Detect() failures (absl::Status) are logged and return no detections
//   - CUDA errors throw (patches/bos-01-nonfatal-cuda.patch) instead of aborting the JVM:
//     the frame is skipped and the detector rebuilt on the next frame; only after
//     the CUDA context stays broken (sticky error) for kMaxFailingTime do we exit so systemd restarts
//     PhotonVision (a broken CUDA context cannot be recovered in-process)
//   - no per-detection std::cout; a once-per-second stats line instead

#include <jni.h>
#include <wpi/jni_util.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iostream>
#include <mutex>
#include <string>

#include <csetjmp>

#include <cuda_runtime.h>
#include <jpeglib.h>
#include <wpi/RawFrame.h>
#include "absl/status/status.h"
#include <opencv2/core/mat.hpp>

#include "apriltag/apriltag.h"
#include "apriltag/tag36h11.h"
#include "third_party/971apriltag/apriltag.h"

void SpectrumInjectStickyCudaFault();  // fault_kernel.cu (test only)

namespace {

wpi::java::JClass detectionCls;

const wpi::java::JClassInit classes[] = {
    {"edu/wpi/first/apriltag/AprilTagDetection", &detectionCls}};

// Contrast threshold for the GPU thresholding step. 4143 used 5, frc971/bos uses 4,
// and RealtimeRoboticsGroup/aos 76d8f216 moved to 20 for speed. Override at launch
// with SPECTRUM_971_MIN_WHITE_BLACK_DIFF.
int MinWhiteBlackDiff() {
  if (const char *v = std::getenv("SPECTRUM_971_MIN_WHITE_BLACK_DIFF")) return std::atoi(v);
  return 5;
}

// How the CPU thread waits for the GPU (cudaSetDeviceFlags, at library load, before any CUDA
// context exists): "auto" (CUDA's default; with one context on 6 cores it spins), "spin",
// "yield" or "block" (sleep). Measured on the bench (2 cameras, 121 fps each, 2026-09-24):
// spin ~192% CPU and 1.6/2.1 ms detect; block ~199% and 1.9/2.5 ms; yield ~200% and 2.2/2.5 ms.
// Blocking saved no CPU and added ~0.3 ms, so the default stays CUDA's. Re-test with 4 cameras.
// Set with SPECTRUM_971_CUDA_SYNC; /tmp/spectrum-971-cuda-sync overrides it (for A/B tests:
// write it, restart PhotonVision).
unsigned CudaScheduleFlag(std::string *name) {
  std::string v = "auto";
  if (const char *e = std::getenv("SPECTRUM_971_CUDA_SYNC")) v = e;
  if (FILE *f = std::fopen("/tmp/spectrum-971-cuda-sync", "r")) {
    char buf[16] = {0};
    if (std::fgets(buf, sizeof(buf), f)) v = std::string(buf).substr(0, std::strcspn(buf, " \r\n"));
    std::fclose(f);
  }
  *name = v;
  if (v == "spin") return cudaDeviceScheduleSpin;
  if (v == "yield") return cudaDeviceScheduleYield;
  if (v == "block") return cudaDeviceScheduleBlockingSync;
  *name = "auto";
  return cudaDeviceScheduleAuto;
}

// Test hooks, read from /tmp/spectrum-971-fault-every (re-read every 30 frames so a test can
// remove it before a restarted process runs):
//   N > 0     every Nth frame hits a real, non-sticky CUDA error (cudaSetDevice on a bad
//             ordinal right before Detect: the NVIDIA/cccl#1791 case) -> frame skipped
//   "sticky"  one null-pointer kernel write: a sticky error that breaks the CUDA context
//             -> the watchdog restarts PhotonVision
constexpr const char *kFaultFile = "/tmp/spectrum-971-fault-every";
constexpr int kFaultSticky = -1;
int FaultEvery() {
  static int n = 0;
  static int calls = 0;
  if (calls++ % 30 == 0) {
    n = 0;
    if (FILE *f = std::fopen(kFaultFile, "r")) {
      char buf[16] = {0};
      if (std::fgets(buf, sizeof(buf), f)) n = (std::strncmp(buf, "sticky", 6) == 0) ? kFaultSticky : std::atoi(buf);
      std::fclose(f);
    }
  }
  return n;
}

frc::apriltag::CameraMatrix DefaultCameraMatrix() {
  return frc::apriltag::CameraMatrix{1, 1, 1, 1};
}

frc::apriltag::DistCoeffs DefaultDistCoeffs() {
  frc::apriltag::DistCoeffs d{};
  d.num_params = 5;
  return d;
}

struct Stats {
  std::chrono::steady_clock::time_point start{};
  int frames = 0;
  int tags = 0;
  int errors = 0;
  double detect_ms = 0, jni_ms = 0, max_ms = 0, margin = 0, min_margin = 1e9;
};

struct DetectorSlot {
  frc::apriltag::GpuDetector *gpu = nullptr;
  apriltag_detector_t *td = nullptr;
  apriltag_family_t *family = nullptr;
  frc::apriltag::CameraMatrix camera_matrix = DefaultCameraMatrix();
  frc::apriltag::DistCoeffs dist_coeffs = DefaultDistCoeffs();
  bool in_use = false;
  bool needs_rebuild = false;
  int consecutive_failures = 0;
  std::chrono::steady_clock::time_point first_failure{};
  std::mutex mu;
  Stats stats;
};

// A broken CUDA context (sticky error) for this long, over at least kMinFailures frames,
// means only a process restart can recover. Time-based because each failed frame also
// rebuilds the detector, so frame count alone stretched this to ~5 s.
constexpr std::chrono::milliseconds kMaxFailingTime{1000};
constexpr int kMinFailures = 3;

constexpr int kMaxDetectors = 10;
DetectorSlot slots[kMaxDetectors];
std::mutex alloc_mu;

DetectorSlot *Slot(jlong handle) {
  if (handle < 0 || handle >= kMaxDetectors) return nullptr;
  if (!slots[handle].in_use) return nullptr;
  return &slots[handle];
}

apriltag_detector_t *MakeTagDetector(apriltag_family_t *family) {
  apriltag_detector_t *td = apriltag_detector_create();
  apriltag_detector_add_family_bits(td, family, 1);
  td->nthreads = 6;
  td->wp = workerpool_create(td->nthreads);
  td->qtp.min_white_black_diff = MinWhiteBlackDiff();
  td->debug = false;
  // GpuDetector CHECKs these (the AprilTag defaults): quad_decimate 2, no deglitch.
  return td;
}

// Rebuilds the GPU detector for a new size or calibration. Caller holds s.mu.
bool Rebuild(DetectorSlot &s, size_t width, size_t height) {
  delete s.gpu;
  s.gpu = nullptr;
  try {
    s.gpu = new frc::apriltag::GpuDetector(width, height, s.td, s.camera_matrix,
                                           s.dist_coeffs, vision::ImageFormat::MONO8);
    s.needs_rebuild = false;
    return true;
  } catch (const std::exception &e) {
    std::cout << "971 detector build " << width << "x" << height << " failed: " << e.what()
              << std::endl;
    return false;
  }
}

// Called with s.mu held after a failed frame or rebuild. The frame is skipped and the detector
// rebuilt next frame. PhotonVision is restarted only if the CUDA *context* is broken: a sticky
// error (illegal address, launch failure) makes every later call fail, including
// cudaDeviceSynchronize, and only a new process recovers. A failure on one camera with a
// healthy context must never take the other cameras down or cause a restart loop.
void RecordFailure(DetectorSlot &s, jlong handle, const char *what) {
  s.needs_rebuild = true;
  auto now = std::chrono::steady_clock::now();
  const bool context_ok = cudaDeviceSynchronize() == cudaSuccess;
  cudaGetLastError();  // clear whatever was pending so the rebuild starts clean
  if (s.consecutive_failures == 0 || context_ok) s.first_failure = now;
  if (++s.consecutive_failures <= 5 || s.consecutive_failures % 30 == 0) {
    std::cout << "971 detector h" << handle << " failure " << s.consecutive_failures << ": "
              << what << (context_ok ? " (CUDA context OK; frame skipped)" : " (CUDA context BROKEN)")
              << std::endl;
  }
  if (!context_ok && s.consecutive_failures >= kMinFailures &&
      now - s.first_failure >= kMaxFailingTime) {
    std::cout << "971 detector h" << handle << ": CUDA context broken for "
              << std::chrono::duration<double>(now - s.first_failure).count()
              << " s; exiting so systemd restarts PhotonVision" << std::endl;
    // _exit, not abort(): SIGABRT runs the JVM crash handler and Apport, which took ~28 s
    // (and a 156 MB /var/crash report) before the process died. Exit code 1 still makes
    // systemd's Restart=on-failure restart it.
    std::_Exit(1);
  }
}

jobject MakeJObject(JNIEnv *env, const apriltag_detection_t *detect) {
  static jmethodID constructor =
      env->GetMethodID(detectionCls, "<init>", "(Ljava/lang/String;IIF[DDD[D)V");
  if (!constructor) return nullptr;

  wpi::java::JLocal<jstring> fam{env, wpi::java::MakeJString(env, detect->family->name)};
  auto homography = detect->H;
  wpi::java::JLocal<jdoubleArray> harr{
      env, wpi::java::MakeJDoubleArray(
               env, {reinterpret_cast<const jdouble *>(homography->data),
                     static_cast<size_t>(homography->nrows * homography->ncols)})};
  wpi::java::JLocal<jdoubleArray> carr{
      env, wpi::java::MakeJDoubleArray(
               env, {reinterpret_cast<const jdouble *>(detect->p), 4 * 2})};

  return env->NewObject(detectionCls, constructor, fam.obj(), static_cast<jint>(detect->id),
                        static_cast<jint>(detect->hamming),
                        static_cast<jfloat>(detect->decision_margin), harr.obj(),
                        static_cast<jdouble>(detect->c[0]), static_cast<jdouble>(detect->c[1]),
                        carr.obj());
}

jobjectArray MakeJObjectArray(JNIEnv *env, const zarray_t *detections) {
  int n = detections ? zarray_size(detections) : 0;
  jobjectArray jarr = env->NewObjectArray(n, detectionCls, nullptr);
  if (!jarr) return nullptr;
  for (int i = 0; i < n; ++i) {
    apriltag_detection_t *det;
    zarray_get(detections, i, &det);
    wpi::java::JLocal<jobject> elem{env, MakeJObject(env, det)};
    env->SetObjectArrayElement(jarr, i, elem.obj());
  }
  return jarr;
}

void RecordStats(Stats &st, jlong handle, const cv::Mat &img, const zarray_t *detections,
                 bool error, std::chrono::steady_clock::time_point t0,
                 std::chrono::steady_clock::time_point t1,
                 std::chrono::steady_clock::time_point t2) {
  using ms = std::chrono::duration<double, std::milli>;
  if (st.frames == 0) st.start = t0;
  double d = ms(t1 - t0).count();
  st.frames++;
  st.errors += error;
  st.detect_ms += d;
  st.jni_ms += ms(t2 - t1).count();
  if (d > st.max_ms) st.max_ms = d;
  int n = detections ? zarray_size(detections) : 0;
  st.tags += n;
  for (int i = 0; i < n; ++i) {
    apriltag_detection_t *det;
    zarray_get(detections, i, &det);
    st.margin += det->decision_margin;
    if (det->decision_margin < st.min_margin) st.min_margin = det->decision_margin;
  }
  double window = std::chrono::duration<double>(t2 - st.start).count();
  if (window >= 1.0) {
    std::cout << "971 stats h" << handle << " " << img.cols << "x" << img.rows << ": "
              << st.frames / window << " calls/s, detect avg " << st.detect_ms / st.frames
              << " ms max " << st.max_ms << " ms, jni " << st.jni_ms / st.frames
              << " ms, tags/frame " << double(st.tags) / st.frames;
    if (st.tags) {
      std::cout << ", margin avg " << st.margin / st.tags << " min " << st.min_margin;
    }
    if (st.errors) std::cout << ", errors " << st.errors;
    std::cout << " [bos]" << std::endl;
    st = Stats{};
  }
}

}  // namespace

extern "C" {

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  JNIEnv *env;
  if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
  for (auto &c : classes) {
    *c.cls = wpi::java::JClass(env, c.name);
    if (!*c.cls) {
      std::cout << "971 library could not find class " << c.name << std::endl;
      return JNI_ERR;
    }
  }
  std::string sync;
  const cudaError_t sync_err = cudaSetDeviceFlags(CudaScheduleFlag(&sync));
  std::cout << "971 library loaded (frc971/bos detector, min_white_black_diff "
            << MinWhiteBlackDiff() << ", CUDA wait " << sync
            << (sync_err == cudaSuccess ? "" : std::string(" FAILED: ") + cudaGetErrorString(sync_err))
            << ")" << std::endl;
  return JNI_VERSION_1_6;
}

// SpectrumJetson: decode a camera's MJPEG frame straight to 8-bit gray, into a Mat Java already
// allocated (PhotonVision's OpenCV owns the memory; this only writes the pixels).
//   int decodeMjpegGray(long rawFramePtr, long cvMatPtr)
//     0 ok, -1 not an MJPEG frame, -2 bad/unsupported JPEG, -3 Mat isn't WxH 8-bit mono
// Why: cscore's own gray path decodes every JPEG to full-colour BGR and then converts it
// (Frame::ConvertImpl), ~8.9 ms a frame on the Orin Nano; this is ~2.6 ms (libjpeg-turbo,
// grayscale output: only the Y component is inverse-DCT'd, no colour conversion).
struct JpegError {
  jpeg_error_mgr mgr;
  std::jmp_buf jump;
};
void JpegErrorExit(j_common_ptr c) {  // libjpeg's default calls exit(): never in a JVM
  std::longjmp(reinterpret_cast<JpegError *>(c->err)->jump, 1);
}
void JpegSilent(j_common_ptr, int) {}

JNIEXPORT jint JNICALL Java_org_photonvision_jni_GpuDetectorJNI_decodeMjpegGray(
    JNIEnv *, jclass, jlong raw_ptr, jlong mat_ptr) {
  auto *frame = reinterpret_cast<WPI_RawFrame *>(raw_ptr);
  auto *mat = reinterpret_cast<cv::Mat *>(mat_ptr);
  if (!frame || !mat) return -2;
  if (frame->pixelFormat != WPI_PIXFMT_MJPEG || !frame->data || frame->size < 4) return -1;
  if (mat->type() != CV_8UC1 || !mat->isContinuous()) return -3;

  jpeg_decompress_struct c;
  JpegError err;
  c.err = jpeg_std_error(&err.mgr);
  err.mgr.error_exit = JpegErrorExit;
  err.mgr.emit_message = JpegSilent;
  if (setjmp(err.jump)) {
    jpeg_destroy_decompress(&c);
    return -2;
  }
  jpeg_create_decompress(&c);
  jpeg_mem_src(&c, frame->data, frame->size);
  if (jpeg_read_header(&c, TRUE) != JPEG_HEADER_OK) {
    jpeg_destroy_decompress(&c);
    return -2;
  }
  c.out_color_space = JCS_GRAYSCALE;
  c.dct_method = JDCT_ISLOW;  // accurate: tag corners depend on clean edges
  jpeg_start_decompress(&c);
  if (static_cast<int>(c.output_width) != mat->cols ||
      static_cast<int>(c.output_height) != mat->rows || c.output_components != 1) {
    jpeg_abort_decompress(&c);
    jpeg_destroy_decompress(&c);
    return -3;
  }
  while (c.output_scanline < c.output_height) {
    JSAMPROW row = mat->ptr<uchar>(static_cast<int>(c.output_scanline));
    jpeg_read_scanlines(&c, &row, 1);
  }
  jpeg_finish_decompress(&c);
  jpeg_destroy_decompress(&c);
  return 0;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM *vm, void *) {
  JNIEnv *env;
  if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) return;
  for (auto &c : classes) c.cls->free(env);
}

JNIEXPORT jlong JNICALL Java_org_photonvision_jni_GpuDetectorJNI_createGpuDetector(
    JNIEnv *, jclass, jint width, jint height) {
  std::lock_guard<std::mutex> alloc_lock(alloc_mu);
  int h = -1;
  for (int i = 0; i < kMaxDetectors; ++i) {
    if (!slots[i].in_use) {
      h = i;
      break;
    }
  }
  if (h < 0) {
    std::cout << "creategpudetector: all " << kMaxDetectors << " slots in use" << std::endl;
    return -1;
  }
  DetectorSlot &s = slots[h];
  std::lock_guard<std::mutex> lock(s.mu);
  s.camera_matrix = DefaultCameraMatrix();
  s.dist_coeffs = DefaultDistCoeffs();
  s.family = tag36h11_create();
  s.td = MakeTagDetector(s.family);
  s.consecutive_failures = 0;
  // If the GPU build fails, keep the slot: processimage retries the build each frame.
  if (!Rebuild(s, width, height)) s.needs_rebuild = true;
  s.stats = Stats{};
  s.in_use = true;
  std::cout << "creategpudetector " << width << "x" << height << " handle " << h << std::endl;
  return h;
}

JNIEXPORT void JNICALL Java_org_photonvision_jni_GpuDetectorJNI_destroyGpuDetector(
    JNIEnv *, jclass, jlong handle) {
  std::lock_guard<std::mutex> alloc_lock(alloc_mu);
  DetectorSlot *s = Slot(handle);
  if (!s) {
    std::cout << "destroygpudetector: bad handle " << handle << std::endl;
    return;
  }
  std::lock_guard<std::mutex> lock(s->mu);
  delete s->gpu;
  s->gpu = nullptr;
  if (s->td) apriltag_detector_destroy(s->td);
  s->td = nullptr;
  if (s->family) tag36h11_destroy(s->family);
  s->family = nullptr;
  s->in_use = false;
  std::cout << "destroygpudetector handle " << handle << std::endl;
}

namespace {

// Stores new intrinsics; the detector is rebuilt with them on the next frame.
// num_params 5 = k1 k2 p1 p2 k3 (k4..k6 zero); 8 = OpenCV rational model, which is what
// PhotonVision's (mrcal) calibration produces.
void SetParams(jlong handle, double fx, double cx, double fy, double cy, double k1, double k2,
               double p1, double p2, double k3, double k4, double k5, double k6,
               int num_params) {
  DetectorSlot *s = Slot(handle);
  if (!s) {
    std::cout << "setparams: bad handle " << handle << std::endl;
    return;
  }
  std::lock_guard<std::mutex> lock(s->mu);
  s->camera_matrix = frc::apriltag::CameraMatrix{fx, cx, fy, cy};
  s->dist_coeffs = DefaultDistCoeffs();
  s->dist_coeffs.k1 = k1;
  s->dist_coeffs.k2 = k2;
  s->dist_coeffs.p1 = p1;
  s->dist_coeffs.p2 = p2;
  s->dist_coeffs.k3 = k3;
  s->dist_coeffs.k4 = k4;
  s->dist_coeffs.k5 = k5;
  s->dist_coeffs.k6 = k6;
  s->dist_coeffs.num_params = num_params;
  std::cout << "setparams handle " << handle << " (" << num_params << " dist coeffs): fx " << fx
            << " cx " << cx << " fy " << fy << " cy " << cy << " k1 " << k1 << " k2 " << k2
            << " p1 " << p1 << " p2 " << p2 << " k3 " << k3;
  if (num_params == 8) std::cout << " k4 " << k4 << " k5 " << k5 << " k6 " << k6;
  std::cout << std::endl;
  // Takes effect on the next frame (processimage rebuilds at the frame's size).
  s->needs_rebuild = true;
}

}  // namespace

JNIEXPORT void JNICALL Java_org_photonvision_jni_GpuDetectorJNI_setparams(
    JNIEnv *, jclass, jlong handle, jdouble fx, jdouble cx, jdouble fy, jdouble cy, jdouble k1,
    jdouble k2, jdouble p1, jdouble p2, jdouble k3) {
  SetParams(handle, fx, cx, fy, cy, k1, k2, p1, p2, k3, 0, 0, 0, 5);
}

JNIEXPORT void JNICALL Java_org_photonvision_jni_GpuDetectorJNI_setparams8(
    JNIEnv *, jclass, jlong handle, jdouble fx, jdouble cx, jdouble fy, jdouble cy, jdouble k1,
    jdouble k2, jdouble p1, jdouble p2, jdouble k3, jdouble k4, jdouble k5, jdouble k6) {
  SetParams(handle, fx, cx, fy, cy, k1, k2, p1, p2, k3, k4, k5, k6, 8);
}

JNIEXPORT jobjectArray JNICALL Java_org_photonvision_jni_GpuDetectorJNI_processimage(
    JNIEnv *env, jclass, jlong handle, jlong p) {
  if (!p) return nullptr;
  cv::Mat &img = *reinterpret_cast<cv::Mat *>(p);
  if (!img.ptr()) return nullptr;
  if (img.type() != CV_8UC1 || !img.isContinuous()) {
    static bool logged = false;
    if (!logged) {
      logged = true;
      std::cout << "processimage: need a continuous 8-bit mono Mat, got type " << img.type()
                << std::endl;
    }
    return nullptr;
  }
  if (img.cols % 8 != 0 || img.rows % 8 != 0) {
    // threshold.cc CHECKs this; refuse instead of aborting the JVM.
    static bool logged = false;
    if (!logged) {
      logged = true;
      std::cout << "processimage: " << img.cols << "x" << img.rows
                << " is not a multiple of 8; skipping" << std::endl;
    }
    return nullptr;
  }

  DetectorSlot *s = Slot(handle);
  if (!s) {
    std::cout << "processimage: bad handle " << handle << std::endl;
    return nullptr;
  }
  std::lock_guard<std::mutex> lock(s->mu);

  // Clear any CUDA error left by an earlier unchecked call; CUB (CCCL >= 2.5) otherwise
  // fails later calls with it, and this detector's CHECK_CUDA would abort the process.
  if (cudaError_t stale = cudaGetLastError(); stale != cudaSuccess) {
    static bool logged = false;
    if (!logged) {
      logged = true;
      std::cout << "processimage: cleared stale CUDA error: " << cudaGetErrorString(stale)
                << std::endl;
    }
  }

  if (!s->gpu || s->needs_rebuild || static_cast<size_t>(img.cols) != s->gpu->width() ||
      static_cast<size_t>(img.rows) != s->gpu->height()) {
    if (s->gpu && !s->needs_rebuild) {
      std::cout << "processimage: size changed to " << img.cols << "x" << img.rows
                << ", rebuilding detector" << std::endl;
    }
    if (!Rebuild(*s, img.cols, img.rows)) {
      RecordFailure(*s, handle, "detector rebuild failed");
      return MakeJObjectArray(env, nullptr);
    }
  }

  auto t0 = std::chrono::steady_clock::now();
  const zarray_t *detections = nullptr;
  bool failed = false;
  if (int every = FaultEvery(); every > 0) {
    static long frame = 0;
    if (++frame % every == 0) cudaSetDevice(9999);  // leaves "invalid device ordinal"
  } else if (every == kFaultSticky) {
    static bool injected = false;
    if (!injected) {
      injected = true;
      std::cout << "971 TEST: injecting a sticky CUDA fault" << std::endl;
      SpectrumInjectStickyCudaFault();
    }
  }
  try {
    absl::Status status = s->gpu->Detect(img.ptr<uint8_t>(), nullptr);
    if (status.ok()) {
      detections = s->gpu->Detections();
      s->consecutive_failures = 0;
    } else {
      failed = true;
      RecordFailure(*s, handle, std::string(status.message()).c_str());
    }
  } catch (const std::exception &e) {
    failed = true;
    cudaGetLastError();  // clear a non-sticky error so the rebuild can succeed
    RecordFailure(*s, handle, e.what());
  }
  auto t1 = std::chrono::steady_clock::now();

  jobjectArray result = MakeJObjectArray(env, detections);
  auto t2 = std::chrono::steady_clock::now();
  RecordStats(s->stats, handle, img, detections, failed, t0, t1, t2);
  return result;
}

}  // extern "C"
