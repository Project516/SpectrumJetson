// fieldcal_detect: replays one camera of a Rewind recording through the 971 CUDA AprilTag
// detector, the same detector and settings PhotonVision uses on the Jetson, and writes every
// tag's corners for tools/fieldcal (field calibration).
//
//   fieldcal_detect CAMERA_DIR OUT.csv [--every N] [--calib fx,fy,cx,cy,k1,k2,p1,p2,k3,k4,k5,k6]
//                   [--mwbd N] [--mse X] [--threads N] [--upscale 2]
//
// CAMERA_DIR: one camera's folder of a Rewind session (NNNN.mjpeg + NNNN.csv, docs/REWIND.md).
// --every N: every Nth frame. --calib: the camera's lens calibration; the detector's edge
// refinement straightens edges with it, as it does in PhotonVision (without it, no undistortion).
// --mwbd / --mse: as SPECTRUM_971_MIN_WHITE_BLACK_DIFF / SPECTRUM_971_MAX_LINE_FIT_MSE, which
// are also read from the environment (defaults 5 and 10, as in GpuDetectorJNI.cc).
// --upscale 2 (experimental, off by default): search at full size. The detector finds quads on a
// half-size image (quad_decimate 2 is hard-wired), which misses tags under ~20 px; a 2x
// nearest-neighbour upscale finds them down to ~12 px, at ~2x the GPU time. Corners are scaled
// back. On a rendered recording (2026-09-24) it found the small steep tags but lost some large
// steep ones (the upscale's stair-stepped edges), 489 vs 506 of 594 views: not worth it there.
//
// OUT.csv, one row per detection, and one row with id -1 for an analysed frame with no tags:
//   frame,jetson_us,id,hamming,margin,x0,y0,x1,y1,x2,y2,x3,y3
// Corners are exactly as PhotonVision receives them: AprilTag's order and pixel convention.
//
// JPEGs are decoded with libjpeg-turbo to gray (JDCT_ISLOW): the same pixels PhotonVision's
// decoders give the detector. Decoding runs on --threads CPU threads (default 5) ahead of the GPU.

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <csetjmp>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <cuda_runtime.h>
#include <jpeglib.h>

#include "absl/status/status.h"
#include "apriltag/apriltag.h"
#include "apriltag/tag36h11.h"
#include "third_party/971apriltag/apriltag.h"

namespace fs = std::filesystem;

namespace {

struct Frame {
  int index;
  long long jetson_us;
  fs::path mjpeg;
  long long offset, size;
  int width, height;
};

struct JpegError {
  jpeg_error_mgr mgr;
  std::jmp_buf jump;
};
void JpegErrorExit(j_common_ptr c) { std::longjmp(reinterpret_cast<JpegError *>(c->err)->jump, 1); }
void JpegQuiet(j_common_ptr, int) {}

// libjpeg-turbo to 8-bit gray, as GpuDetectorJNI.cc's TurboDecode does. false on a bad JPEG.
bool DecodeGray(const std::vector<unsigned char> &jpeg, std::vector<uint8_t> &out, int width, int height) {
  jpeg_decompress_struct c;
  JpegError err;
  c.err = jpeg_std_error(&err.mgr);
  err.mgr.error_exit = JpegErrorExit;
  err.mgr.emit_message = JpegQuiet;
  if (setjmp(err.jump)) {
    jpeg_destroy_decompress(&c);
    return false;
  }
  jpeg_create_decompress(&c);
  jpeg_mem_src(&c, const_cast<unsigned char *>(jpeg.data()), jpeg.size());
  if (jpeg_read_header(&c, TRUE) != JPEG_HEADER_OK) {
    jpeg_destroy_decompress(&c);
    return false;
  }
  c.out_color_space = JCS_GRAYSCALE;
  c.dct_method = JDCT_ISLOW;
  jpeg_start_decompress(&c);
  if (static_cast<int>(c.output_width) != width || static_cast<int>(c.output_height) != height ||
      c.output_components != 1) {
    jpeg_abort_decompress(&c);
    jpeg_destroy_decompress(&c);
    return false;
  }
  out.resize(static_cast<size_t>(width) * height);
  while (c.output_scanline < c.output_height) {
    JSAMPROW row = out.data() + static_cast<size_t>(c.output_scanline) * width;
    jpeg_read_scanlines(&c, &row, 1);
  }
  jpeg_finish_decompress(&c);
  jpeg_destroy_decompress(&c);
  return true;
}

// Every frame of a camera folder, in order (the Jetson writes "# frame,offset,size,width,height,
// jetson_us,robot_us"). A frame past the end of its .mjpeg (recording cut mid-write) ends a segment.
std::vector<Frame> ReadIndex(const fs::path &dir) {
  std::vector<fs::path> csvs;
  for (auto &e : fs::directory_iterator(dir)) {
    const auto name = e.path().filename().string();
    if (e.path().extension() == ".csv" && !name.empty() && std::isdigit(static_cast<unsigned char>(name[0])))
      csvs.push_back(e.path());
  }
  std::sort(csvs.begin(), csvs.end());
  std::vector<Frame> frames;
  int n = 0;
  for (const auto &csv : csvs) {
    fs::path mj = csv;
    mj.replace_extension(".mjpeg");
    if (!fs::exists(mj)) continue;
    const long long length = static_cast<long long>(fs::file_size(mj));
    std::ifstream in(csv);
    std::string line;
    while (std::getline(in, line)) {
      if (line.empty() || line[0] == '#' || !std::isdigit(static_cast<unsigned char>(line[0]))) continue;
      std::stringstream ss(line);
      std::string f[7];
      for (int i = 0; i < 7 && std::getline(ss, f[i], ','); ++i) {
      }
      Frame fr{n++, std::atoll(f[5].c_str()), mj, std::atoll(f[1].c_str()), std::atoll(f[2].c_str()),
               std::atoi(f[3].c_str()), std::atoi(f[4].c_str())};
      if (fr.offset + fr.size > length) break;
      frames.push_back(fr);
    }
  }
  return frames;
}

double EnvOr(const char *name, double fallback) {
  const char *v = std::getenv(name);
  return v && *v ? std::atof(v) : fallback;
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 3) {
    std::cerr << "usage: fieldcal_detect CAMERA_DIR OUT.csv [--every N] "
                 "[--calib fx,fy,cx,cy,k1,k2,p1,p2,k3,k4,k5,k6] [--mwbd N] [--mse X] [--threads N] [--upscale 2]\n";
    return 2;
  }
  const fs::path dir = argv[1];
  const std::string out_path = argv[2];
  int every = 1, threads = 5, upscale = 1;
  int mwbd = static_cast<int>(EnvOr("SPECTRUM_971_MIN_WHITE_BLACK_DIFF", 5));
  double mse = EnvOr("SPECTRUM_971_MAX_LINE_FIT_MSE", 10.0);
  frc::apriltag::CameraMatrix cam{1, 1, 1, 1};  // with zero distortion: no undistortion
  frc::apriltag::DistCoeffs dist{};
  dist.num_params = 5;
  for (int i = 3; i < argc; ++i) {
    const std::string a = argv[i];
    const char *v = i + 1 < argc ? argv[i + 1] : "";
    if (a == "--every") every = std::max(1, std::atoi(v)), ++i;
    else if (a == "--threads") threads = std::max(1, std::atoi(v)), ++i;
    else if (a == "--upscale") upscale = std::atoi(v) == 2 ? 2 : 1, ++i;
    else if (a == "--mwbd") mwbd = std::atoi(v), ++i;
    else if (a == "--mse") mse = std::atof(v), ++i;
    else if (a == "--calib") {
      double k[12] = {};
      std::stringstream ss(v);
      std::string t;
      int n = 0;
      while (n < 12 && std::getline(ss, t, ',')) k[n++] = std::atof(t.c_str());
      if (n != 12) {
        std::cerr << "--calib needs 12 numbers: fx,fy,cx,cy,k1,k2,p1,p2,k3,k4,k5,k6\n";
        return 2;
      }
      cam = frc::apriltag::CameraMatrix{k[0], k[2], k[1], k[3]};  // {fx, cx, fy, cy}
      dist.k1 = k[4], dist.k2 = k[5], dist.p1 = k[6], dist.p2 = k[7], dist.k3 = k[8];
      dist.k4 = k[9], dist.k5 = k[10], dist.k6 = k[11];
      dist.num_params = 8;
      ++i;
    } else {
      std::cerr << "unknown option " << a << "\n";
      return 2;
    }
  }

  std::vector<Frame> all = ReadIndex(dir);
  std::vector<Frame> frames;
  for (size_t i = 0; i < all.size(); i += every) frames.push_back(all[i]);
  if (frames.empty()) {
    std::cerr << dir << ": no frames\n";
    return 1;
  }
  const int width = frames[0].width, height = frames[0].height;
  const int dw = width * upscale, dh = height * upscale;  // what the detector sees
  if (upscale == 2) {
    // The lens calibration in the upscaled image's pixels (OpenCV convention: centres at integers).
    cam = frc::apriltag::CameraMatrix{cam.fx * 2, (cam.cx + 0.5) * 2 - 0.5, cam.fy * 2, (cam.cy + 0.5) * 2 - 0.5};
  }
  if (width % 8 || height % 8) {
    std::cerr << width << "x" << height << " is not a multiple of 8 (the 971 detector needs that)\n";
    return 1;
  }

  // As GpuDetectorJNI.cc's MakeTagDetector.
  apriltag_family_t *family = tag36h11_create();
  apriltag_detector_t *td = apriltag_detector_create();
  apriltag_detector_add_family_bits(td, family, 1);
  td->nthreads = 6;
  td->wp = workerpool_create(td->nthreads);
  td->qtp.min_white_black_diff = mwbd;
  td->qtp.max_line_fit_mse = static_cast<float>(mse);
  td->debug = false;
  auto *gpu = new frc::apriltag::GpuDetector(dw, dh, td, cam, dist, vision::ImageFormat::MONO8);
  std::vector<uint8_t> big(upscale == 2 ? static_cast<size_t>(dw) * dh : 0);

  // Decode ahead on CPU threads into a ring of slots; the GPU detects in frame order.
  const size_t ring = static_cast<size_t>(threads) * 4;
  std::vector<std::vector<uint8_t>> gray(ring);
  std::vector<std::atomic<int>> state(ring);  // 0 free, 1 ready, 2 bad
  for (auto &s : state) s = 0;
  std::atomic<size_t> next{0};
  std::atomic<bool> stop{false};
  std::vector<std::thread> workers;
  for (int t = 0; t < threads; ++t) {
    workers.emplace_back([&] {
      std::vector<unsigned char> jpeg;
      std::ifstream file;
      fs::path open_path;
      for (size_t i = next++; i < frames.size() && !stop; i = next++) {
        const size_t slot = i % ring;
        while (state[slot] != 0 && !stop) std::this_thread::sleep_for(std::chrono::microseconds(200));
        const Frame &f = frames[i];
        if (open_path != f.mjpeg) {
          file.close();
          file.open(f.mjpeg, std::ios::binary);
          open_path = f.mjpeg;
        }
        jpeg.resize(static_cast<size_t>(f.size));
        file.seekg(f.offset);
        file.read(reinterpret_cast<char *>(jpeg.data()), f.size);
        state[slot] = DecodeGray(jpeg, gray[slot], width, height) ? 1 : 2;
      }
    });
  }

  std::FILE *out = std::fopen(out_path.c_str(), "w");
  if (!out) {
    std::cerr << "can't write " << out_path << "\n";
    stop = true;
    for (auto &w : workers) w.join();
    return 1;
  }
  std::fprintf(out, "frame,jetson_us,id,hamming,margin,x0,y0,x1,y1,x2,y2,x3,y3\n");
  const auto t0 = std::chrono::steady_clock::now();
  long tags = 0, bad = 0, failed = 0;
  double detect_ms = 0;
  for (size_t i = 0; i < frames.size(); ++i) {
    const size_t slot = i % ring;
    while (state[slot] == 0) std::this_thread::sleep_for(std::chrono::microseconds(100));
    const Frame &f = frames[i];
    if (state[slot] == 2) {
      ++bad;
      state[slot] = 0;
      continue;
    }
    const auto d0 = std::chrono::steady_clock::now();
    const uint8_t *img = gray[slot].data();
    if (upscale == 2) {
      for (int y = 0; y < height; ++y) {
        const uint8_t *src = img + static_cast<size_t>(y) * width;
        uint8_t *row = big.data() + static_cast<size_t>(2 * y) * dw;
        for (int x = 0; x < width; ++x) row[2 * x] = row[2 * x + 1] = src[x];
        std::memcpy(row + dw, row, dw);
      }
      img = big.data();
    }
    absl::Status st = gpu->Detect(img, nullptr);
    detect_ms += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - d0).count();
    state[slot] = 0;
    if (!st.ok()) {
      ++failed;
      continue;
    }
    const zarray_t *dets = gpu->Detections();
    const int n = dets ? zarray_size(dets) : 0;
    if (n == 0) std::fprintf(out, "%d,%lld,-1,,,,,,,,,,\n", f.index, f.jetson_us);
    for (int k = 0; k < n; ++k) {
      apriltag_detection_t *d;
      zarray_get(dets, k, &d);
      std::fprintf(out, "%d,%lld,%d,%d,%.3f", f.index, f.jetson_us, d->id, d->hamming, d->decision_margin);
      // AprilTag's convention (a pixel spans k..k+1) scales exactly: original = upscaled / 2.
      for (int c = 0; c < 4; ++c) std::fprintf(out, ",%.4f,%.4f", d->p[c][0] / upscale, d->p[c][1] / upscale);
      std::fprintf(out, "\n");
      ++tags;
    }
  }
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  for (auto &w : workers) w.join();
  std::fclose(out);
  std::cerr << dir.filename().string() << ": " << frames.size() << " frames (" << width << "x" << height
            << (upscale == 2 ? ", searched at full size" : "") << ") in " << secs << " s, " << frames.size() / std::max(secs, 1e-9) << " fps; detect "
            << detect_ms / std::max<size_t>(1, frames.size()) << " ms/frame; " << tags << " tags"
            << (bad ? "; bad JPEGs " + std::to_string(bad) : "")
            << (failed ? "; failed frames " + std::to_string(failed) : "") << "\n";
  delete gpu;
  apriltag_detector_destroy(td);
  tag36h11_destroy(family);
  return 0;
}
