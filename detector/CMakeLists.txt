# Drop-in lib971apriltag.so for the FRC-Team-4143 PhotonVision fork, built from
# Austin Schuh's current CUDA AprilTag detector as packaged in frc971/bos
# (third_party/971apriltag) plus our JNI bridge (GpuDetectorJNI.cc).
#
# Configure with -DBOS_DIR=<frc971/bos checkout with the abseil-cpp submodule>.
# scripts/jetson/07-build-bos-detector.sh does the fetch + build.
cmake_minimum_required(VERSION 3.21)

set(CMAKE_CUDA_COMPILER /usr/local/cuda/bin/nvcc CACHE FILEPATH "")
project(spectrum_971apriltag C CXX CUDA)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 20)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_ARCHITECTURES 87)  # Orin
set(CMAKE_CUDA20_STANDARD_COMPILE_OPTION "-std=c++20")
set(CMAKE_CUDA20_EXTENSION_COMPILE_OPTION "-std=c++20")
set(CMAKE_CUDA_FLAGS "--expt-relaxed-constexpr")
# Everything ends up inside one shared library loaded by the JVM.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(BOS_DIR "" CACHE PATH "frc971/bos checkout")
if(NOT EXISTS "${BOS_DIR}/third_party/971apriltag/apriltag.h")
  message(FATAL_ERROR "BOS_DIR must point at a frc971/bos checkout")
endif()

# Same globals frc971/bos's top-level CMakeLists.txt sets for its subprojects.
find_package(CUDAToolkit REQUIRED)
include_directories(${CUDAToolkit_INCLUDE_DIRS})
link_directories(${CUDAToolkit_LIBRARY_DIR})
add_compile_options($<$<COMPILE_LANGUAGE:C,CXX>:-march=armv8-a+simd> $<$<COMPILE_LANGUAGE:C,CXX>:-Wno-psabi>)

set(ABSL_PROPAGATE_CXX_STD ON)
set(ABSL_ENABLE_INSTALL OFF)
add_subdirectory(${BOS_DIR}/third_party/abseil-cpp abseil EXCLUDE_FROM_ALL)
add_subdirectory(${BOS_DIR}/third_party/971apriltag 971apriltag EXCLUDE_FROM_ALL)

find_package(JNI REQUIRED)
find_package(OpenCV REQUIRED core)

add_library(971apriltag_jni SHARED GpuDetectorJNI.cc fault_kernel.cu)
set_target_properties(971apriltag_jni PROPERTIES OUTPUT_NAME 971apriltag)
target_include_directories(971apriltag_jni PRIVATE ${BOS_DIR} ${JNI_INCLUDE_DIRS}
                                                   ${OpenCV_INCLUDE_DIRS})
# bos uses ABSL_FLAG (use_neon, debug_blob_index) but its CMake does not link absl::flags.
target_link_libraries(971apriltag_jni PRIVATE 971apriltag absl::flags wpiutil CUDA::cudart
                                              ${JNI_LIBRARIES})
# Fail at link time, not in the JVM, if a symbol is missing.
target_link_options(971apriltag_jni PRIVATE -Wl,--no-undefined)
