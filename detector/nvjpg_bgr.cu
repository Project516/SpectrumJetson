// SpectrumJetson: YCbCr 4:2:2 (NVJPG's output planes) -> BGR on the GPU, for snj_decode_bgr
// (NvJpgDecoder.cc). It does exactly what libjpeg(-turbo) does with its default settings, which is
// what cscore's cv::imdecode gives PhotonVision: h2v1 "fancy" chroma upsampling (jdsample.c) and
// the YCbCr->RGB tables of jdcolor.c. Measured identical to libjpeg-turbo's JCS_EXT_BGR on 384
// real-colour 4:2:2 frames at quality 50-95 (tests/jpeg-hw), so the safety-net check can be exact.

#include <cstdint>

#include <cuda_runtime.h>

namespace {

// jdcolor.c build_ycc_rgb_table (SCALEBITS 16), indexed by the 8-bit Cb/Cr value.
__constant__ int kCrR[256], kCbB[256], kCrG[256], kCbG[256];

__global__ void Ycc422ToBgr(const uint8_t *__restrict__ y, int y_pitch,
                            const uint8_t *__restrict__ cb, const uint8_t *__restrict__ cr,
                            int c_pitch, uint8_t *__restrict__ out, int out_pitch, int width,
                            int height, int c_width) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;  // chroma column: output pixels 2i, 2i+1
  const int row = blockIdx.y;
  if (i >= c_width || row >= height) return;
  const uint8_t *b = cb + static_cast<size_t>(row) * c_pitch;
  const uint8_t *r = cr + static_cast<size_t>(row) * c_pitch;
  const int b0 = b[i], r0 = r[i];
  // h2v1_fancy_upsample: 3/4 of the nearer sample + 1/4 of the further one; the edges copy.
  const int bl = i == 0 ? b0 : (3 * b0 + b[i - 1] + 1) >> 2;
  const int rl = i == 0 ? r0 : (3 * r0 + r[i - 1] + 1) >> 2;
  const int br = i == c_width - 1 ? b0 : (3 * b0 + b[i + 1] + 2) >> 2;
  const int rr = i == c_width - 1 ? r0 : (3 * r0 + r[i + 1] + 2) >> 2;
  const uint8_t *yr = y + static_cast<size_t>(row) * y_pitch;
  uint8_t *o = out + static_cast<size_t>(row) * out_pitch;
#pragma unroll
  for (int k = 0; k < 2; ++k) {
    const int x = 2 * i + k;
    if (x >= width) break;
    const int Y = yr[x], cbv = k ? br : bl, crv = k ? rr : rl;
    o[3 * x + 0] = static_cast<uint8_t>(min(max(Y + kCbB[cbv], 0), 255));
    o[3 * x + 1] = static_cast<uint8_t>(min(max(Y + ((kCbG[cbv] + kCrG[crv]) >> 16), 0), 255));
    o[3 * x + 2] = static_cast<uint8_t>(min(max(Y + kCrR[crv], 0), 255));
  }
}

}  // namespace

// Uploads the tables (once per process; the constant memory lives in the primary context).
cudaError_t SnjInitBgrTables() {
  int cr_r[256], cb_b[256], cr_g[256], cb_g[256];
  const long one_half = 1L << 15;
  auto fix = [](double x) { return static_cast<long>(x * (1L << 16) + 0.5); };
  for (int i = 0, x = -128; i < 256; ++i, ++x) {
    cr_r[i] = static_cast<int>((fix(1.40200) * x + one_half) >> 16);
    cb_b[i] = static_cast<int>((fix(1.77200) * x + one_half) >> 16);
    cr_g[i] = static_cast<int>(-fix(0.71414) * x);
    cb_g[i] = static_cast<int>(-fix(0.34414) * x + one_half);
  }
  cudaError_t e = cudaMemcpyToSymbol(kCrR, cr_r, sizeof(cr_r));
  if (e == cudaSuccess) e = cudaMemcpyToSymbol(kCbB, cb_b, sizeof(cb_b));
  if (e == cudaSuccess) e = cudaMemcpyToSymbol(kCrG, cr_g, sizeof(cr_g));
  if (e == cudaSuccess) e = cudaMemcpyToSymbol(kCbG, cb_g, sizeof(cb_g));
  return e;
}

cudaError_t SnjYcc422ToBgr(const uint8_t *y, int y_pitch, const uint8_t *cb, const uint8_t *cr,
                           int c_pitch, uint8_t *out, int out_pitch, int width, int height,
                           int c_width, cudaStream_t stream) {
  const dim3 threads(128, 1), blocks((c_width + 127) / 128, height);
  Ycc422ToBgr<<<blocks, threads, 0, stream>>>(y, y_pitch, cb, cr, c_pitch, out, out_pitch, width,
                                              height, c_width);
  return cudaGetLastError();
}
