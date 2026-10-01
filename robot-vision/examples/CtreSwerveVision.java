// EXAMPLE (not compiled with the library): SpectrumVision on a CTRE Phoenix 6 swerve drivetrain
// (the TunerX-generated CommandSwerveDrivetrain). Adapt the names to your project.
//
// WPILib 2026 (roboRIO): imports as below.
// WPILib 2027 (SystemCore): the same code with org.wpilib.* imports, e.g.
//   org.wpilib.vision.apriltag.AprilTagFieldLayout, org.wpilib.math.geometry.*, org.wpilib.system.Timer
// (the library's 2027 drop already uses them; your robot code needs its own imports changed).
package frc.robot.vision;

import com.ctre.phoenix6.Utils;
import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.apriltag.AprilTagFields;
import edu.wpi.first.math.geometry.Rotation3d;
import edu.wpi.first.math.geometry.Transform3d;
import edu.wpi.first.math.util.Units;
import edu.wpi.first.wpilibj.RobotBase;
import frc.robot.subsystems.CommandSwerveDrivetrain;
import org.spectrum3847.vision.VisionSystem;
import org.spectrum3847.vision.VisionUpdate;
import org.spectrum3847.vision.sim.VisionSim;
import org.spectrum3847.vision.sink.PoseSink;

public class Vision {
    // Measure these (or let SpectrumJetson's field calibration measure them): CAD is often 1-3 cm and
    // a degree or two off, and a degree of camera yaw is 7 cm of error at 4 m.
    static final Transform3d ROBOT_TO_TOP_LEFT = new Transform3d(
            Units.inchesToMeters(10), Units.inchesToMeters(11), Units.inchesToMeters(20),
            new Rotation3d(0, Math.toRadians(-15), Math.toRadians(30)));
    static final Transform3d ROBOT_TO_TOP_RIGHT = new Transform3d(
            Units.inchesToMeters(10), Units.inchesToMeters(-11), Units.inchesToMeters(20),
            new Rotation3d(0, Math.toRadians(-15), Math.toRadians(-30)));

    private final CommandSwerveDrivetrain drivetrain;
    private final VisionSystem vision;
    private VisionSim sim;

    public Vision(CommandSwerveDrivetrain drivetrain) {
        this.drivetrain = drivetrain;
        // The same layout PhotonVision uses for multi-tag (SpectrumJetson: Settings > AprilTag field layout).
        var field = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);
        vision = VisionSystem.builder(field)
                .camera("TopLeft", ROBOT_TO_TOP_LEFT)        // names exactly as in PhotonVision
                .camera("TopRight", ROBOT_TO_TOP_RIGHT)
                // Phoenix keeps its own clock: convert robot time to it.
                .sink(PoseSink.convertingTime(drivetrain::addVisionMeasurement, Utils::fpgaToCurrentTime))
                .currentEstimate(() -> drivetrain.getState().Pose)
                .build();
        // The gyro history at Phoenix's odometry rate (250 Hz), with Phoenix's timestamps converted
        // to robot time. Runs on Phoenix's odometry thread; the history is thread-safe.
        drivetrain.registerTelemetry(state -> vision.addMotion(
                Utils.currentTimeToFPGATime(state.Timestamp),
                state.Pose.getRotation(),
                state.Speeds.omegaRadiansPerSecond,
                Math.hypot(state.Speeds.vxMetersPerSecond, state.Speeds.vyMetersPerSecond)));
        if (RobotBase.isSimulation()) sim = VisionSim.attach(vision, VisionSim.thriftiestCam());
    }

    /** Call from Robot.robotPeriodic(), after CommandScheduler.run(). */
    public VisionUpdate periodic() {
        return vision.periodic();
    }

    /** Call from Robot.simulationPeriodic(), with the simulated drivetrain's true pose. */
    public void simulationPeriodic() {
        if (sim != null) sim.update(drivetrain.getState().Pose);
    }

    public VisionSystem system() {
        return vision;
    }
}
