package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;
import static org.spectrum3847.vision.TestField.*;

import edu.wpi.first.math.geometry.Pose3d;
import edu.wpi.first.math.geometry.Rotation2d;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.io.FakeCameraIO;
import org.spectrum3847.vision.observation.FrameObservation;
import org.spectrum3847.vision.testing.SyntheticCamera;

/** What one periodic() costs: 4 cameras, 3 frames each (120 fps at a 20 ms loop), 3 tags a frame. */
class TimingTest {
    @Test
    void periodicCost() {
        var ios = new ArrayList<FakeCameraIO>();
        double[] now = {10};
        var b = VisionSystem.builder(FIELD).offline().clock(() -> now[0]).sink((p, t, s) -> {});
        for (int i = 0; i < 4; i++) {
            var io = new FakeCameraIO("Cam" + i);
            ios.add(io);
            b.camera(io, FRONT, 1);
        }
        var vs = b.build();
        var cam = SyntheticCamera.typical("Cam", 1);
        var robot = new Pose3d(facingWall(3, 4));
        var frames = new ArrayList<FrameObservation>();
        for (int k = 0; k < 3; k++) frames.add(cam.frame(FIELD, robot, FRONT, 0));
        int loops = 2000, warm = 500;
        long t0 = 0;
        for (int l = 0; l < loops + warm; l++) {
            if (l == warm) t0 = System.nanoTime();
            now[0] += 0.02;
            vs.addMotion(now[0], Rotation2d.fromDegrees(180), 0, 0);
            for (var io : ios) {
                for (int k = 0; k < 3; k++) {
                    var f = frames.get(k);
                    io.queue(new FrameObservation(io.name(), l * 3 + k, now[0] - 0.03 + k * 0.008, 1000,
                            f.multiTagFieldToCamera(), f.multiTagReprojErrPx(), f.multiTagIds(), f.tags()));
                }
            }
            vs.periodic();
        }
        double us = (System.nanoTime() - t0) / 1e3 / loops;
        System.out.printf("periodic(): %.0f µs a loop for 4 cameras x 3 frames (this machine)%n", us);
        assertEquals(loops * 12L + warm * 12L, vs.stats().all().frames);
        assertTrue(us < 20_000, "a loop must fit in 20 ms even on a slow machine");
    }
}
