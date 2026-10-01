// EXAMPLE (compiled in both builds against AdvantageKit 26.0.2 and 27.0.0-alpha-4): SpectrumVision
// with AdvantageKit, so a match log replays
// through the same solvers, gates and trust (change a gate, replay the match, compare).
//
// The camera inputs are logged as one double[] per camera (ObservationCodec): the compact record,
// not raw PhotonLib results (README "Logging": raw results are ~10x bigger and AdvantageKit sends
// them to every dashboard). In replay, the log feeds ReplayCameraIO instead of PhotonVision.
package frc.robot.vision;

import edu.wpi.first.math.geometry.Pose2d;
import org.littletonrobotics.junction.LogTable;
import org.littletonrobotics.junction.Logger;
import org.littletonrobotics.junction.inputs.LoggableInputs;
import org.spectrum3847.vision.VisionUpdate;
import org.spectrum3847.vision.io.CameraIO;
import org.spectrum3847.vision.io.PhotonCameraIO;

/** Wraps any CameraIO: logs its inputs when real, reads them back from the log in replay. */
public class AdvantageKitVision implements CameraIO {
    private final String name;
    private final CameraIO real; // null in replay
    private final LoggedInputs logged = new LoggedInputs();

    public static AdvantageKitVision real(String name) {
        return new AdvantageKitVision(name, PhotonCameraIO.of(name));
    }

    public static AdvantageKitVision replay(String name) {
        return new AdvantageKitVision(name, null);
    }

    private AdvantageKitVision(String name, CameraIO real) {
        this.name = name;
        this.real = real;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public void update(Inputs inputs) {
        if (real != null) real.update(logged.inputs);
        Logger.processInputs("Vision/" + name, logged); // records, or in replay restores
        inputs.connected = logged.inputs.connected;
        inputs.frames = logged.inputs.frames;
        inputs.resultCount = logged.inputs.resultCount;
        inputs.qualityMatched = logged.inputs.qualityMatched;
    }

    private final class LoggedInputs implements LoggableInputs {
        final Inputs inputs = new Inputs();

        @Override
        public void toLog(LogTable table) {
            table.put("Connected", inputs.connected);
            table.put("Frames", inputs.framesAsArray());
            table.put("ResultCount", inputs.resultCount);
            table.put("QualityMatched", inputs.qualityMatched);
        }

        @Override
        public void fromLog(LogTable table) {
            inputs.connected = table.get("Connected", false);
            inputs.framesFromArray(name, table.get("Frames", new double[0]));
            inputs.resultCount = table.get("ResultCount", 0);
            inputs.qualityMatched = table.get("QualityMatched", 0L);
        }
    }

    /** Outputs worth logging each loop (they're recomputed in replay, so they're outputs). */
    public static void logOutputs(VisionUpdate u) {
        Logger.recordOutput("Vision/AcceptedPoses", u.acceptedPoses().toArray(new Pose2d[0]));
        Logger.recordOutput("Vision/RejectedPoses", u.rejectedPoses().toArray(new Pose2d[0]));
        Logger.recordOutput("Vision/AcceptedCount", u.accepted().size());
        if (!u.rejected().isEmpty()) {
            var r = u.rejected().get(u.rejected().size() - 1);
            Logger.recordOutput("Vision/LastRejection", r.observation().camera() + ": " + r.gate() + ": " + r.reason());
        }
    }
}
// In RobotContainer:
//   var cam = Robot.isReal() ? AdvantageKitVision.real("TopLeft") : AdvantageKitVision.replay("TopLeft");
//   vision = VisionSystem.builder(field).camera(cam, ROBOT_TO_TOP_LEFT, 1.0)...
//       .logger(VisionLogger.NONE)   // AdvantageKit logs instead
//       .build();
//   // robotPeriodic: AdvantageKitVision.logOutputs(vision.periodic());
