// EXAMPLE (a unit test to copy into your robot project's src/test/java): check your vision settings
// against scenarios before a match. Plain Java: no robot, no PhotonVision, runs with ./gradlew test.
// Needs JUnit 5 in the robot project (GradleRIO's template already has it). This exact file also
// runs in SpectrumVision's own test suite, so it's known to work.
package org.spectrum3847.vision.examples;

import static org.junit.jupiter.api.Assertions.*;

import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.apriltag.AprilTagFields;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Rotation3d;
import edu.wpi.first.math.geometry.Transform3d;
import edu.wpi.first.math.geometry.Translation2d;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.gate.Gates;
import org.spectrum3847.vision.testing.SyntheticCamera;
import org.spectrum3847.vision.testing.VisionScenario;

class VisionTuningTest {
    static final AprilTagFieldLayout FIELD = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);
    // Your camera's mount (copy it from your Vision class).
    static final Transform3d ROBOT_TO_CAMERA = new Transform3d(0.25, 0, 0.5, new Rotation3d(0, Math.toRadians(-15), 0));

    /** Your cameras and your gates, as the robot builds them. */
    VisionScenario robot() {
        var cam = SyntheticCamera.typical("Front", 1);
        cam.pixelNoise = 0.4; // what your cameras really show; ~0.3-0.5 px for a good global shutter
        cam.poseNoise = 0.005;
        return new VisionScenario(FIELD)
                .camera(cam, ROBOT_TO_CAMERA)
                .configure(b -> b.gates(Gates.recommended().replace(Gates.maxYawRate(5.0))));
    }

    /** The robot {@code back} metres in front of tag {@code id}, {@code side} metres to one side, facing it. */
    static Pose2d facingTag(int id, double back, double side) {
        var tag = FIELD.getTagPose(id).orElseThrow().toPose2d();
        var out = new Translation2d(back, side).rotateBy(tag.getRotation());
        return new Pose2d(tag.getTranslation().plus(out), tag.getRotation().plus(Rotation2d.k180deg));
    }

    @Test
    void drivingPastATagIsAccurate() {
        int tag = FIELD.getTags().get(0).ID;
        var s = robot();
        // Sideways past the tag at 1 m/s, 2.5 m out (pick the tags your robot really drives past).
        s.run(0, 2, 0.02, t -> facingTag(tag, 2.5, -1 + t), 0, 1.0);
        System.out.println(s.stats().summary());
        assertTrue(s.stats().all().accepted > 50, "vision keeps up while driving: " + s.stats().summary());
        assertTrue(s.worstErrorMeters() < 0.10, "worst accepted error " + s.worstErrorMeters());
    }

    @Test
    void spinningFastIsRejected() {
        int tag = FIELD.getTags().get(0).ID;
        var s = robot();
        s.run(0, 1, 0.02, t -> facingTag(tag, 2.5, 0), 7.0, 0);
        assertEquals(0, s.stats().all().accepted, s.stats().summary());
    }
}
