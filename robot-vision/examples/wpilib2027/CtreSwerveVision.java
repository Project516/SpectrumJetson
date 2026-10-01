// EXAMPLE: SpectrumVision on a CTRE Phoenix 6 swerve drivetrain. Pass your TunerX-generated
// CommandSwerveDrivetrain (it extends Phoenix's SwerveDrivetrain). Compiled in both of the
// library's builds against Phoenix 6 26.3.0 (2026) and 26.50.0-alpha-1 (2027), so it's known to
// build; adapt the camera names and mounts.
//
// This is the WPILib 2027 (SystemCore, Phoenix 26.50.0-alpha-1) version; the 2026 one is
// examples/CtreSwerveVision.java. The differences: org.wpilib imports, and Phoenix 2027's swerve
// state has Velocity (ChassisVelocities: vx, vy, omega) instead of Speeds (ChassisSpeeds).
package frc.robot.vision;

import com.ctre.phoenix6.Utils;
import com.ctre.phoenix6.swerve.SwerveDrivetrain;
import org.wpilib.vision.apriltag.AprilTagFieldLayout;
import org.wpilib.vision.apriltag.AprilTagFields;
import org.wpilib.math.geometry.Rotation3d;
import org.wpilib.math.geometry.Transform3d;
import org.wpilib.math.util.Units;
import org.wpilib.framework.RobotBase;
import org.spectrum3847.vision.VisionSystem;
import org.spectrum3847.vision.VisionUpdate;
import org.spectrum3847.vision.sink.ClockBridge;
import org.spectrum3847.vision.sim.VisionSim;
import org.spectrum3847.vision.sink.PoseSink;

public class CtreSwerveVision {
    // Measure these (or let SpectrumJetson's field calibration measure them): CAD is often 1-3 cm and
    // a degree or two off, and a degree of camera yaw is 7 cm of error at 4 m.
    static final Transform3d ROBOT_TO_TOP_LEFT = new Transform3d(
            Units.inchesToMeters(10), Units.inchesToMeters(11), Units.inchesToMeters(20),
            new Rotation3d(0, Math.toRadians(-15), Math.toRadians(30)));
    static final Transform3d ROBOT_TO_TOP_RIGHT = new Transform3d(
            Units.inchesToMeters(10), Units.inchesToMeters(-11), Units.inchesToMeters(20),
            new Rotation3d(0, Math.toRadians(-15), Math.toRadians(-30)));

    private final SwerveDrivetrain<?, ?, ?> drivetrain;
    private final VisionSystem vision;
    private VisionSim sim;

    public CtreSwerveVision(SwerveDrivetrain<?, ?, ?> drivetrain) {
        this.drivetrain = drivetrain;
        // The same layout PhotonVision uses for multi-tag (SpectrumJetson: Settings > AprilTag field layout).
        var field = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);
        // Robot time <-> Phoenix time, measured as it converts (Phoenix 2026 also has
        // Utils.fpgaToCurrentTime; 2027 doesn't, and this works on both).
        var phoenix = new ClockBridge(Utils::getCurrentTimeSeconds);
        vision = VisionSystem.builder(field)
                .camera("TopLeft", ROBOT_TO_TOP_LEFT)        // names exactly as in PhotonVision
                .camera("TopRight", ROBOT_TO_TOP_RIGHT)
                // Phoenix keeps its own clock: convert robot time to it.
                .sink(PoseSink.convertingTime(drivetrain::addVisionMeasurement, phoenix::toOther))
                .currentEstimate(() -> drivetrain.getState().Pose)
                .build();
        // The gyro history at Phoenix's odometry rate (250 Hz), with Phoenix's timestamps converted
        // to robot time. Runs on Phoenix's odometry thread; the history is thread-safe.
        drivetrain.registerTelemetry(state -> vision.addMotion(
                phoenix.fromOther(state.Timestamp),
                state.Pose.getRotation(),
                state.Velocity.omega,
                Math.hypot(state.Velocity.vx, state.Velocity.vy)));
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
