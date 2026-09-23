# Handoff: flashing the Jetson Orin Nano Super (Spectrum 3847/8515)

You are helping flash a **Jetson Orin Nano Super Developer Kit** to an **NVMe
SSD** from an **Ubuntu 22.04 x86-64 host**, then build the vision stack on it.
This brief is self-contained — you were not part of the conversation that
produced it.

---

## 0. The one decision that will save you an afternoon

**We are flashing stock JetPack 6.2. We are NOT building a Yocto image.**

An earlier plan involved `frc4646/meta-frc4646` — a custom Yocto/OpenEmbedded
rootfs used by FRC teams 4646, 1868, 2910 and 254 to run the AOS vision stack.
**That plan was dropped.** If you find references to meta-frc4646, bitbake,
`demo-image-base`, `to_xfs.py`, `initrd-flash` from that repo, or
`RealtimeRoboticsGroup/aos` — those are from the abandoned path. Ignore them.

We are instead running **PhotonVision** with FRC 971's CUDA AprilTag detector
underneath it, which runs on ordinary JetPack. That is why the flash is simple.

---

## 1. Hardware state

- **Jetson Orin Nano Super Developer Kit** — P3768 carrier + Orin Nano 8GB module
  (P3767-0005). Purchased new, so its QSPI firmware should already be JetPack 6
  capable.
- **NVMe SSD installed**: Inland TN320 256 GB, M.2 Key M 2280, PCIe Gen3 x4.
  This is the correct part — the devkit's main M.2 Key M slot is Gen3 x4, so
  nothing is being left on the table.
- **No SD card. Boot must be from NVMe.** This is a hard requirement.
- Host: **Ubuntu 22.04 x86-64** (a supported SDK Manager host — 20.04 and 22.04
  are the supported versions).
- USB-C data cable from the host to the **carrier board's USB-C port**.

Cameras (for later, not needed to flash): 2x Thrifty Bot **Thriftiest Cam** —
OV9281, mono, global shutter, **1280x800**, up to 120 fps, **USB 2.0**.

---

## 2. Target

**JetPack 6.2** = Jetson Linux **36.4.3**, kernel 5.15, Ubuntu 22.04 rootfs.

JetPack 6.2 is what introduces **MAXN SUPER** power mode — the reason the board
is called "Super". An older JetPack would boot but leave performance on the
table. Do not flash JetPack 5.x or 6.0/6.1.

---

## 3. Entering force-recovery mode

The devkit must be in Force Recovery Mode (RCM) before the host can flash it.

1. Power off, USB-C cable connected from carrier to host.
2. **Jumper pins 9 and 10 of the button header** (FC REC to GND). Some carrier
   revisions have a tactile FC REC button instead — check the silkscreen.
3. Apply power while the jumper is in place.
4. Remove the jumper.
5. **Verify on the host**: `lsusb` should list an NVIDIA device (vendor `0955`).
   If nothing appears, the board is not in RCM — do not proceed, retry the
   jumper timing.

---

## 4. Flashing — pick one path

### Path A: SDK Manager (recommended for the first flash)

Download NVIDIA SDK Manager for Ubuntu from developer.nvidia.com, install, log
in with an NVIDIA developer account.

- Target hardware: **Jetson Orin Nano 8GB (developer kit)**
- Target OS: **JetPack 6.2**
- When it reaches the flash step, choose **storage device: NVMe**, not SD card.
- It will update QSPI bootloader firmware as part of flashing.

Needs a lot of host disk — budget **40 GB+** for downloads plus the rootfs.

### Path B: Command line (Jetson Linux BSP)

Download the Jetson Linux 36.4.3 **Driver Package (BSP)** and **Sample Root
Filesystem**, extract, run `apply_binaries.sh`, then flash. For the Super
configuration with NVMe, the board config is `jetson-orin-nano-devkit-super`:

```bash
sudo ./tools/kernel_flash/l4t_initrd_flash.sh \
  --external-device nvme0n1p1 \
  -c tools/kernel_flash/flash_l4t_t234_nvme.xml \
  -p "-c bootloader/generic/cfg/flash_t234_qspi.xml" \
  --showlogs --network usb0 \
  jetson-orin-nano-devkit-super internal
```

**Verify the exact flags against the Jetson Linux Developer Guide for 36.4.3
before running** — this command is assembled from documentation, not from a
flash performed on this hardware. The older `flash.sh jetson-orin-nano-devkit-nvme
nvme0n1p1` form also appears in the wild; prefer the initrd flash path for JP6.

Path A is more forgiving. Use Path B if SDK Manager misbehaves or you want the
flash scripted.

---

## 5. Post-flash verification — do all of these

```bash
lsblk                      # root should be on nvme0n1p1, NOT mmcblk*
cat /etc/nv_tegra_release   # expect R36, REVISION: 4.3
sudo nvpmodel -q            # list power modes; MAXN SUPER should be present
sudo nvpmodel -m <maxn_super_id>
sudo jetson_clocks
tegrastats                  # confirm clocks and thermals
nvcc --version              # CUDA present
```

If `nvpmodel -q` does not offer MAXN SUPER, the firmware/JetPack combination is
wrong — that is the signal you flashed the wrong version, not a hardware fault.

---

## 6. Then: build the vision stack

Repos:

- `FRC-Team-4143/photonvision` branch **`jetson-orin`** — PhotonVision fork
- `FRC-Team-4143/GpuDetectorJNI` — 971's CUDA AprilTag library wrapped for it
- (`person4268/GpuDetectorJNI` is a stripped generic-GPU variant, not needed)

The `GpuDetectorJNI` README gives exact steps for a fresh JetPack 6.2 install:

```bash
sudo apt install openjdk-17-jdk

# add to .bashrc
export PATH=$PATH:/usr/local/cuda/bin
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/cuda/lib64
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64/

git clone https://github.com/wpilibsuite/allwpilib.git
cd allwpilib
sudo apt install ninja-build protobuf-compiler libxrandr-dev libssh-dev libopencv4.5-java
cmake --preset default -DWITH_GUI=OFF -DWITH_JAVA=ON \
      -DWITH_SIMULATION_MODULES=OFF -DWITH_TESTS=OFF \
      -DOPENCV_JAR_FILE=/usr/share/java/opencv.jar
cd build-cmake
cmake --build . --parallel 4    # more parallelism may OOM on wpimath
sudo cmake --build . --target install

cd ../..
git clone https://github.com/FRC-Team-4143/GpuDetectorJNI.git
cd GpuDetectorJNI/third_party/apriltag && mkdir build && cd build && cmake .. && make
cd ../../.. && mkdir build && cd build && cmake .. && make
sudo cp lib971apriltag.so /usr/lib
```

⚠️ **Building allwpilib on the Orin is the long pole — hours, not minutes**, and
`--parallel` above 4 can OOM on wpimath. Start it and do something else. Do not
raise the parallelism to "speed it up".

---

## 7. What is already known about the detector (no need to re-derive)

Someone read `GpuDetectorJNI.cc` in full. Findings:

- **Resolution is a runtime parameter.** `createGpuDetector(jint width, jint
  height)`, and `processimage` detects a size mismatch and rebuilds the detector
  on the fly. Changing resolution in the PhotonVision UI just works.
- **Calibration is runtime too.** `setparams(fx, cx, fy, cy, k1, k2, p1, p2, k3)`
  rebuilds the detector with new intrinsics. PhotonVision's calibration feeds
  straight through.
- It calls `DetectGrayHost()` — **grayscale single-channel input**. The mono
  cameras feed it directly with no conversion.
- Two rough edges worth knowing:
  - `processimage` does `std::cout` **per detection per frame**. At 60-120 fps
    that is a lot of unbuffered I/O in the hot path. First thing to comment out
    if throughput disappoints.
  - Detector handles are never recycled: `createGpuDetector` increments a
    counter and refuses past 10; `destroyGpuDetector` nulls pointers without
    decrementing. One detector per camera at startup is fine.

---

## 8. Camera gotchas (for when cameras get plugged in)

- **USB 2.0 is the constraint.** ~40 MB/s practical, shared per controller. YUYV
  at 1280x800 does not fit for two cameras; **MJPEG is required**.
- Run `lsusb -t` and confirm the two cameras are **not on the same USB 2.0 root
  hub** — same hub means they split 480 Mbps.
- If v4l2 refuses the second camera on bandwidth grounds, that is the known UVC
  over-declaration problem. Fix with `/etc/modprobe.d/uvc.conf`:
  `options uvcvideo quirks=128 bandwidth_quirk_divisor=8` (other FRC teams use
  8 or 2). Reboot or reload `uvcvideo` after changing.

---

## 9. Ask before assuming

1. Static IP or DHCP/mDNS on the robot network, and what hostname.
2. Whether PhotonVision should be installed as a service that starts at boot.
3. Which PhotonVision fork branch/commit — confirm `jetson-orin` is still current
   before building.

---

## 10. Scope

Flash, verify, build, and get PhotonVision serving a web UI with at least one
camera detecting a tag. **Pose fusion and multi-source comparison are a separate
project** on the robot controller (SystemCore/roboRIO) and are not your task.
