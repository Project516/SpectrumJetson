package org.spectrum3847.vision.compat;

import org.wpilib.system.Timer;

/** Robot time in seconds, the timebase of PhotonLib's timestamps (WPILib 2027 build). */
public final class Clock {
    private Clock() {}

    public static double now() {
        return Timer.getTimestamp();
    }
}
