// EXAMPLE (compiled in both builds): SpectrumVision with WPILib's SwerveDrivePoseEstimator,
// plus a second estimator (an EKF, say) fed the same measurements to compare side by side.
package frc.robot.vision;

import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.apriltag.AprilTagFields;
import edu.wpi.first.math.estimator.SwerveDrivePoseEstimator;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Transform3d;
import edu.wpi.first.wpilibj.Timer;
import org.spectrum3847.vision.VisionSystem;
import org.spectrum3847.vision.gate.Gates;
import org.spectrum3847.vision.sink.PoseSink;

public class WpilibSwerveVision {
    private final VisionSystem vision;

    public WpilibSwerveVision(SwerveDrivePoseEstimator estimator, PoseSink ekf, Transform3d robotToFront, Transform3d robotToBack) {
        vision = VisionSystem.builder(AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField))
                .camera("Front", robotToFront)
                .camera("Back", robotToBack)
                // Both get every accepted measurement, oldest first.
                .sink(PoseSink.all(PoseSink.wpilib(estimator), ekf))
                .currentEstimate(estimator::getEstimatedPosition)
                // One change from the recommended gates: this robot spins fast while scoring.
                .gates(Gates.recommended().replace(Gates.maxYawRate(5.0)))
                .build();
    }

    /** robotPeriodic(), after estimator.update(gyro, modulePositions). */
    public void periodic(double gyroYawRad, double yawRateRadPerSec, double speedMetersPerSec) {
        vision.addMotion(Timer.getTimestamp(), new Rotation2d(gyroYawRad), yawRateRadPerSec, speedMetersPerSec);
        vision.periodic();
    }
}
