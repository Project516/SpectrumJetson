package org.spectrum3847.vision;

import edu.wpi.first.apriltag.AprilTag;
import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Pose3d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Rotation3d;
import edu.wpi.first.math.geometry.Transform3d;
import java.util.List;
import org.spectrum3847.vision.testing.SyntheticCamera;

/** A small field for tests: three tags on the x = 0 wall facing into the field, 1 m up. */
final class TestField {
    static final AprilTagFieldLayout FIELD = new AprilTagFieldLayout(
            List.of(
                    new AprilTag(1, new Pose3d(0, 3, 1, new Rotation3d())),
                    new AprilTag(2, new Pose3d(0, 4, 1, new Rotation3d())),
                    new AprilTag(3, new Pose3d(0, 5, 1, new Rotation3d()))),
            16.5,
            8.0);

    /** A front camera: 30 cm forward, 50 cm up, tilted up 10°. */
    static final Transform3d FRONT = new Transform3d(0.3, 0, 0.5, new Rotation3d(0, Math.toRadians(-10), 0));

    /** Facing the wall (heading 180°) at (x, y). */
    static Pose2d facingWall(double x, double y) {
        return new Pose2d(x, y, Rotation2d.fromDegrees(180));
    }

    static SyntheticCamera camera(String name) {
        return SyntheticCamera.typical(name, 42);
    }

    private TestField() {}
}
