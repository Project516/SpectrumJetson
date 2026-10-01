package org.spectrum3847.vision.compat;

import org.photonvision.PhotonCamera;

/** PhotonLib differences between the builds (WPILib 2027, PhotonLib 2027 alpha). */
public final class CameraCompat {
    private CameraCompat() {}

    public static void requestEnabled(PhotonCamera camera, boolean enabled) {
        camera.setEnabled(enabled);
    }
}
