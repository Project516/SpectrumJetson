package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;
import static org.spectrum3847.vision.TestField.*;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Pose3d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Rotation3d;
import edu.wpi.first.math.geometry.Transform3d;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.gate.Gates;
import org.spectrum3847.vision.io.FakeCameraIO;
import org.spectrum3847.vision.testing.SyntheticCamera;
import org.spectrum3847.vision.testing.VisionScenario;

class VisionSystemTest {
    @Test
    void standingStillEveryFrameAcceptedAndAccurate() {
        var s = new VisionScenario(FIELD).camera(camera("TopLeft"), FRONT);
        s.run(1, 2, 0.02, t -> facingWall(3, 4), 0, 0);
        var all = s.stats().all();
        assertTrue(all.accepted > 40, s.stats().summary());
        assertEquals(0, all.rejected(), s.stats().summary());
        assertTrue(s.worstErrorMeters() < 1e-6);
    }

    @Test
    void noisyFramesStayClose() {
        var cam = SyntheticCamera.typical("TopLeft", 7);
        cam.pixelNoise = 0.5;
        cam.poseNoise = 0.01;
        var s = new VisionScenario(FIELD).camera(cam, FRONT);
        s.run(1, 2, 0.02, t -> facingWall(2.5 + 0.5 * (t - 1), 4), 0, 0.5);
        assertTrue(s.stats().all().accepted > 40, s.stats().summary());
        assertTrue(s.worstErrorMeters() < 0.15, "worst " + s.worstErrorMeters());
    }

    @Test
    void spinningIsRejected() {
        var s = new VisionScenario(FIELD).camera(camera("TopLeft"), FRONT);
        s.run(1, 1.5, 0.02, t -> facingWall(3, 4), 5.0, 0);
        assertEquals(0, s.stats().all().accepted);
        assertTrue(s.stats().all().rejectedBy.getOrDefault("maxYawRate", 0L) > 0, s.stats().summary());
    }

    @Test
    void aLooserGateIsOneLine() {
        var s = new VisionScenario(FIELD)
                .camera(camera("TopLeft"), FRONT)
                .configure(b -> b.gates(Gates.recommended().replace(Gates.maxYawRate(6))));
        s.run(1, 1.5, 0.02, t -> facingWall(3, 4), 5.0, 0);
        assertTrue(s.stats().all().accepted > 10, s.stats().summary());
    }

    @Test
    void measurementsGoOutOldestFirstAcrossCameras() {
        var left = new FakeCameraIO("Left");
        var right = new FakeCameraIO("Right");
        var times = new ArrayList<Double>();
        double[] now = {10.0};
        var vs = VisionSystem.builder(FIELD)
                .offline()
                .clock(() -> now[0])
                .camera(left, FRONT, 1)
                .camera(right, FRONT, 1)
                .sink((pose, t, std) -> times.add(t))
                .build();
        vs.addMotion(9.8, Rotation2d.fromDegrees(180), 0, 0);
        vs.addMotion(10.0, Rotation2d.fromDegrees(180), 0, 0);
        var robot = new Pose3d(facingWall(3, 4));
        var cl = SyntheticCamera.typical("Left", 1);
        var cr = SyntheticCamera.typical("Right", 2);
        // Right's frames are older than Left's, and arrive in the same loop.
        left.queue(cl.frame(FIELD, robot, FRONT, 9.97), cl.frame(FIELD, robot, FRONT, 9.99));
        right.queue(cr.frame(FIELD, robot, FRONT, 9.95), cr.frame(FIELD, robot, FRONT, 9.98));
        vs.periodic();
        assertEquals(4, times.size());
        for (int i = 1; i < times.size(); i++) assertTrue(times.get(i) >= times.get(i - 1), times.toString());
    }

    @Test
    void cameraTrustAndDisable() {
        var io = new FakeCameraIO("Cam");
        var got = new ArrayList<Double>();
        double[] now = {5.0};
        var vs = VisionSystem.builder(FIELD).offline().clock(() -> now[0])
                .camera(io, FRONT, 1).sink((p, t, std) -> got.add(std.get(0, 0))).build();
        var cam = SyntheticCamera.typical("Cam", 3);
        var robot = new Pose3d(facingWall(3, 4));
        io.queue(cam.frame(FIELD, robot, FRONT, 4.98));
        vs.periodic();
        vs.camera("Cam").setTrustFactor(3);
        io.queue(cam.frame(FIELD, robot, FRONT, 4.99));
        vs.periodic();
        assertEquals(3 * got.get(0), got.get(1), 1e-9);
        vs.camera("Cam").setEnabled(false);
        io.queue(cam.frame(FIELD, robot, FRONT, 5.0));
        vs.periodic();
        assertEquals(2, got.size(), "disabled camera: frames read, not used");
    }

    @Test
    void aMountChangeIsUsedAtOnce() {
        var io = new FakeCameraIO("Cam");
        var poses = new ArrayList<Pose2d>();
        double[] now = {5.0};
        var vs = VisionSystem.builder(FIELD).offline().clock(() -> now[0])
                .camera(io, FRONT, 1).sink((p, t, std) -> poses.add(p)).build();
        var cam = SyntheticCamera.typical("Cam", 3);
        var robot = new Pose3d(facingWall(3, 4));
        // The camera is really 10 cm further forward than configured.
        var real = new Transform3d(0.4, 0, 0.5, new Rotation3d(0, Math.toRadians(-10), 0));
        io.queue(cam.frame(FIELD, robot, real, 4.98));
        vs.periodic();
        vs.camera("Cam").setRobotToCamera(real);
        io.queue(cam.frame(FIELD, robot, real, 4.99));
        vs.periodic();
        assertEquals(0.1, poses.get(0).getTranslation().getDistance(robot.toPose2d().getTranslation()), 1e-6);
        assertEquals(0, poses.get(1).getTranslation().getDistance(robot.toPose2d().getTranslation()), 1e-6);
    }
}
