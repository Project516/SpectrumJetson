package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;
import static org.spectrum3847.vision.TestField.*;

import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.math.geometry.Pose3d;
import edu.wpi.first.math.geometry.Rotation2d;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.heading.RobotMotionHistory;
import org.spectrum3847.vision.observation.PoseObservation.Type;
import org.spectrum3847.vision.solve.Solvers;

class SolverTest {
    static RobotMotionHistory gyro(double t, double headingDeg) {
        var m = new RobotMotionHistory();
        m.add(t - 0.1, Rotation2d.fromDegrees(headingDeg), 0, 0);
        m.add(t + 0.01, Rotation2d.fromDegrees(headingDeg), 0, 0);
        return m;
    }

    @Test
    void multiTagRecoversThePose() {
        var robot = new Pose3d(facingWall(3, 4.2));
        var frame = camera("c").frame(FIELD, robot, FRONT, 1.0);
        assertNotNull(frame);
        assertTrue(frame.hasMultiTag(), "3 tags in view: multi-tag");
        var obs = Solvers.standard().solve(frame, FRONT, FIELD, gyro(1.0, 180));
        assertEquals(1, obs.size());
        assertEquals(Type.MULTI_TAG, obs.get(0).type());
        var p = obs.get(0).robotPose();
        assertEquals(0, p.getTranslation().getDistance(robot.getTranslation()), 1e-6);
        assertEquals(0, p.getRotation().getZ() - robot.getRotation().getZ(), 1e-6);
        assertEquals(3, obs.get(0).tagCount());
        assertEquals(0, obs.get(0).headingDisagreementRad(), 1e-6);
    }

    @Test
    void singleTagBestWhenUnambiguous() {
        var cam = camera("c");
        cam.multiTag = false;
        var robot = new Pose3d(facingWall(2.5, 4.0));
        var frame = cam.frame(FIELD, robot, FRONT, 1.0);
        var solver = Solvers.singleTag(new Solvers.SingleTagConfig().preferTrig(false));
        var obs = solver.solve(frame, FRONT, FIELD, null);
        assertFalse(obs.isEmpty());
        for (var o : obs) {
            assertEquals(Type.SINGLE_TAG, o.type());
            assertEquals(0, o.robotPose().getTranslation().getDistance(robot.getTranslation()), 1e-6);
        }
    }

    @Test
    void ambiguousTagIsResolvedByTheGyro() {
        var cam = camera("c");
        cam.multiTag = false;
        cam.ambiguity = 0.5;
        cam.flipSolutions = true; // the wrong solution looks best
        var robot = new Pose3d(facingWall(2.5, 3.6));
        var frame = cam.frame(FIELD, robot, FRONT, 1.0);
        var solver = Solvers.singleTag(new Solvers.SingleTagConfig().preferTrig(false));
        // Without a gyro: ambiguous, so nothing.
        assertTrue(solver.solve(frame, FRONT, FIELD, null).isEmpty());
        // With it: the solution that agrees with the gyro, which is the true one.
        var obs = solver.solve(frame, FRONT, FIELD, gyro(1.0, 180));
        assertFalse(obs.isEmpty());
        for (var o : obs) {
            assertEquals(Type.SINGLE_TAG_GYRO, o.type());
            assertEquals(0, o.robotPose().getTranslation().getDistance(robot.getTranslation()), 1e-6);
        }
    }

    @Test
    void trigSolveIgnoresTheTagsOrientation() {
        var cam = camera("c");
        cam.multiTag = false;
        cam.ambiguity = 0.6;
        cam.flipSolutions = true; // orientation wrong, position right
        var robot = new Pose3d(facingWall(3.2, 4.4));
        var frame = cam.frame(FIELD, robot, FRONT, 2.0);
        var obs = Solvers.standard().solve(frame, FRONT, FIELD, gyro(2.0, 180));
        assertFalse(obs.isEmpty());
        for (var o : obs) {
            assertEquals(Type.TAG_TRIG, o.type());
            assertEquals(0, o.robotPose().getTranslation().toTranslation2d().getDistance(robot.getTranslation().toTranslation2d()), 1e-6);
            assertEquals(Math.PI, Math.abs(o.robotPose().getRotation().getZ()), 1e-9);
        }
    }

    @Test
    void noTagPoseNoCandidate() {
        var cam = camera("c");
        var frame = cam.frame(FIELD, new Pose3d(facingWall(3, 4)), FRONT, 1.0);
        var empty = new AprilTagFieldLayout(List.of(), 16.5, 8);
        assertTrue(Solvers.standard().solve(frame, FRONT, empty, gyro(1.0, 180)).stream()
                .noneMatch(o -> o.type() != Type.MULTI_TAG));
    }
}
