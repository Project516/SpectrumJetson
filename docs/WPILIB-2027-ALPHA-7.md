# WPILib 2027 alpha-7 migration

The current robot and Jetson pins are a tested pair. The robot uses WPILib
2027.0.0-alpha-6 with PhotonLib v2027.0.0-alpha-2. The Jetson runs the 2026
FRC-Team-4143 CUDA fork, based on WPILib 2026.2.1.

WPILib 2027.0.0-alpha-7 is the next migration target. Its release notes warn
that alpha-6 and earlier vendordeps do not work with alpha-7. No matching
stable PhotonLib alpha-7 release was found during this review. Do not replace
the robot vendordep with a development asset and call the pair supported.

## What the migration must cover

1. Rebase the CUDA PhotonVision fork and its patches onto the PhotonVision
   source that pins WPILib 2027.0.0-alpha-7.
2. Port the native bridge from the old `wpi/jni_util.h` and `wpi/RawFrame.h`
   includes to the alpha-7 headers, then rebuild the detector on ARM64.
3. Build PhotonLib from a reviewed alpha-7-compatible source or a future tagged
   release. The current alpha-2 tag is not a substitute.
4. Run the camera, AprilTag, pose, time-sync, NetworkTables, and memory tests
   on the Jetson.
5. Test the Jetson and SystemCore together on the competition network.

A successful x86 build does not validate CUDA, NVJPG, OpenCV, TensorRT, ARM64
linking, or the robot protocol. Those checks require the real Jetson and robot.
