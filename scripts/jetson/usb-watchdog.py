#!/usr/bin/env python3
"""USB controller watchdog for the Jetson: usb-watchdog.service, installed by 14-usb-watchdog.sh.

If the kernel says the USB host controller died ("xHCI host controller not responding, assume
dead", "HC died"), every camera is gone. PhotonVision keeps running, though, so the hardware
watchdog never fires. This resets the controller by rebinding its driver (tegra-xusb, 3610000.usb);
PhotonVision then reopens the cameras as they come back.

- No reboot: a reboot hung twice (2026-09-25) with cameras stuck on the USB hub, and a reboot
  doesn't cut USB power anyway.
- Limit: at most one reset a minute.
- Known limit: the reset is like a hub reset. A Thriftiest Cam that a hub reset leaves stuck
  (it stops answering) comes back only when its power is cut: replug it, or power-cycle the robot.
  The Global Shutter cameras come back by themselves.

Test (resets every USB device):
  echo "usb-watchdog test: xHCI host controller not responding, assume dead" | sudo tee /dev/kmsg
"""

import re
import subprocess
import time
from pathlib import Path

CONTROLLER = "3610000.usb"
DRIVER = Path("/sys/bus/platform/drivers/tegra-xusb")
DEAD = re.compile(r"xHCI host (controller )?not responding|assume dead|HC died|Host halt failed", re.I)
MIN_INTERVAL_S = 60


def log(msg: str) -> None:
    print(msg, flush=True)  # to the journal: journalctl -u usb-watchdog


def cameras() -> list[str]:
    """USB ports with a camera on them now."""
    return sorted(p.name.split(":")[0] for p in Path("/sys/bus/usb/drivers/uvcvideo").glob("*:1.0"))


def reset(before: list[str]) -> None:
    log(f"Resetting the USB controller ({CONTROLLER}); cameras before: {', '.join(before) or 'none'}")
    try:
        if (DRIVER / CONTROLLER).exists():
            (DRIVER / "unbind").write_text(CONTROLLER)
            time.sleep(2)
        (DRIVER / "bind").write_text(CONTROLLER)
    except OSError as e:
        log(f"The USB controller reset failed ({e}): power-cycle the robot")
        return
    deadline = time.time() + 60  # a stuck camera costs ~20 s of kernel retries per port
    now: list[str] = []
    while time.time() < deadline:
        time.sleep(1)
        now = cameras()
        if before and set(before) <= set(now):
            break
    missing = sorted(set(before) - set(now))
    if not Path("/sys/bus/usb/devices/usb1").exists():
        log("The USB controller didn't come back: power-cycle the robot")
    elif missing:
        log(f"USB controller reset; cameras back: {', '.join(now) or 'none'}. Still missing: "
            f"{', '.join(missing)} (a camera stuck after a hub reset needs its power cut: replug it, "
            "or power-cycle the robot)")
    else:
        log(f"USB controller reset; every camera is back ({', '.join(now) or 'none'})")


def main() -> None:
    log(f"Watching the kernel log for a dead USB controller; cameras now: {', '.join(cameras()) or 'none'}")
    last_reset = 0.0
    seen: list[str] = cameras()  # the cameras from before the trouble
    seen_at = time.time()
    proc = subprocess.Popen(["journalctl", "-k", "-f", "-n", "0", "-o", "cat"],
                            stdout=subprocess.PIPE, text=True, bufsize=1)
    assert proc.stdout
    for line in proc.stdout:
        if time.time() - seen_at > 5:
            now = cameras()
            if len(now) >= len(seen) or time.time() - seen_at > 300:
                seen = now
            seen_at = time.time()
        if not DEAD.search(line):
            continue
        log(f"USB controller trouble in the kernel log: {line.strip()}")
        if time.time() - last_reset < MIN_INTERVAL_S:
            log("Reset it less than a minute ago: not again yet")
            continue
        last_reset = time.time()
        reset(seen)
    raise SystemExit("journalctl stopped")  # systemd restarts us


if __name__ == "__main__":
    main()
