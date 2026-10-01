package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;

import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.apriltag.AprilTagFields;
import edu.wpi.first.hal.HAL;
import edu.wpi.first.math.VecBuilder;
import edu.wpi.first.math.estimator.SwerveDrivePoseEstimator;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Rotation3d;
import edu.wpi.first.math.geometry.Transform3d;
import edu.wpi.first.math.geometry.Translation2d;
import edu.wpi.first.math.kinematics.SwerveDriveKinematics;
import edu.wpi.first.math.kinematics.SwerveModulePosition;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj.simulation.DriverStationSim;
import edu.wpi.first.wpilibj.simulation.SimHooks;
import java.util.TreeMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.observation.PoseObservation;
import org.spectrum3847.vision.sim.VisionSim;
import org.spectrum3847.vision.sink.PoseSink;

/**
 * The whole chain the way a robot runs it, in WPILib's simulation: PhotonLib's VisionSystemSim
 * renders the field's tags for the robot's true pose, a real PhotonCamera receives the results over
 * NetworkTables, PhotonCameraIO reads them (with robot-side tag quality from the simulated
 * calibration), and VisionSystem corrects a SwerveDrivePoseEstimator that started a metre wrong.
 * Needs WPILib's and PhotonLib's desktop native libraries (the simTest task unpacks them).
 */
class SimulationTest {
    static final AprilTagFieldLayout FIELD = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);
    static final Transform3d ROBOT_TO_CAMERA = new Transform3d(0.25, 0, 0.5, new Rotation3d(0, Math.toRadians(-15), 0));

    @BeforeAll
    static void sim() {
        assertTrue(HAL.initialize(500, 0));
        SimHooks.pauseTiming();
        NetworkTableInstance.getDefault().startLocal();
    }

    @AfterAll
    static void done() {
        SimHooks.resumeTiming();
    }

    static Pose2d facingTag(int id, double back, double side) {
        var tag = FIELD.getTagPose(id).orElseThrow().toPose2d();
        var out = new Translation2d(back, side).rotateBy(tag.getRotation());
        return new Pose2d(tag.getTranslation().plus(out), tag.getRotation().plus(Rotation2d.k180deg));
    }

    @Test
    void visionPullsAWrongEstimateOntoTheTruth() {
        int tag = FIELD.getTags().get(0).ID;
        Pose2d truth = facingTag(tag, 2.5, 0);
        var kinematics = new SwerveDriveKinematics(
                new Translation2d(0.3, 0.3), new Translation2d(0.3, -0.3), new Translation2d(-0.3, 0.3), new Translation2d(-0.3, -0.3));
        var modules = new SwerveModulePosition[] {
            new SwerveModulePosition(), new SwerveModulePosition(), new SwerveModulePosition(), new SwerveModulePosition()
        };
        // The estimator thinks the robot is 1 m away from where it is (it was placed by hand).
        var wrong = new Pose2d(truth.getTranslation().plus(new Translation2d(1.0, 0.5)), truth.getRotation());
        var estimator = new SwerveDrivePoseEstimator(
                kinematics, truth.getRotation(), modules, wrong, VecBuilder.fill(0.05, 0.05, 0.01), VecBuilder.fill(0.5, 0.5, 1.0));

        var types = new TreeMap<PoseObservation.Type, Integer>();
        var vision = VisionSystem.builder(FIELD)
                .camera("SimCam", ROBOT_TO_CAMERA)
                .sink(PoseSink.wpilib(estimator))
                .currentEstimate(estimator::getEstimatedPosition)
                .build();
        var sim = VisionSim.attach(vision, VisionSim.thriftiestCam());

        DriverStationSim.setEnabled(false); // placed on the field, disabled: the innovation gate lets vision in
        DriverStationSim.notifyNewData();
        double startError = estimator.getEstimatedPosition().getTranslation().getDistance(truth.getTranslation());
        for (int i = 0; i < 150; i++) { // 3 s
            SimHooks.stepTiming(0.02);
            sim.update(truth);
            double now = Timer.getTimestamp();
            estimator.updateWithTime(now, truth.getRotation(), modules);
            vision.addMotion(now, truth.getRotation(), 0, 0);
            var u = vision.periodic();
            for (var a : u.accepted()) types.merge(a.observation().type(), 1, Integer::sum);
        }
        double endError = estimator.getEstimatedPosition().getTranslation().getDistance(truth.getTranslation());
        var all = vision.stats().all();
        System.out.printf("sim: %d frames, %d accepted %s; estimate error %.3f m -> %.3f m%n%s",
                all.frames, all.accepted, types, startError, endError, vision.stats().summary());
        assertTrue(all.frames > 50, "PhotonLib's simulated camera produced frames: " + all.frames);
        assertTrue(all.accepted > 50, vision.stats().summary());
        assertTrue(endError < 0.05, "the estimate converged on the truth: " + endError + " m");

        // The robot-side quality came from the simulated camera's calibration (PhotonLib publishes it).
        var f = vision.camera("SimCam").inputs().frames;
        var last = vision.lastUpdate().frames().isEmpty() ? null : vision.lastUpdate().frames().get(0);
        assertNotNull(last);
        assertFalse(Double.isNaN(last.tags().get(0).edgePx()), "edge distance computed on the robot");
        assertFalse(Double.isNaN(last.tags().get(0).reprojBestPx()), "reprojection computed on the robot");
        assertNotNull(f);
    }

    @Test
    void drivingWhileEnabledStaysOnTheTruth() {
        int tag = FIELD.getTags().get(1).ID;
        var kinematics = new SwerveDriveKinematics(
                new Translation2d(0.3, 0.3), new Translation2d(0.3, -0.3), new Translation2d(-0.3, 0.3), new Translation2d(-0.3, -0.3));
        var modules = new SwerveModulePosition[] {
            new SwerveModulePosition(), new SwerveModulePosition(), new SwerveModulePosition(), new SwerveModulePosition()
        };
        Pose2d start = facingTag(tag, 1.6, -1.2);
        // Odometry that drifts: the estimator is told the robot moves 10% less than it does.
        var estimator = new SwerveDrivePoseEstimator(
                kinematics, start.getRotation(), modules, start, VecBuilder.fill(0.05, 0.05, 0.01), VecBuilder.fill(0.5, 0.5, 1.0));
        var types = new TreeMap<PoseObservation.Type, Integer>();
        var vision = VisionSystem.builder(FIELD)
                .camera("SimCam2", ROBOT_TO_CAMERA)
                .sink(PoseSink.wpilib(estimator))
                .currentEstimate(estimator::getEstimatedPosition)
                .build();
        var sim = VisionSim.attach(vision, VisionSim.thriftiestCam());
        DriverStationSim.setEnabled(true);
        DriverStationSim.notifyNewData();
        double worst = 0, speed = 0.8; // m/s sideways past the tag, 1.6 m out (one tag in view at times)
        double moved = 0;
        for (int i = 0; i < 150; i++) {
            SimHooks.stepTiming(0.02);
            double t = (i + 1) * 0.02;
            Pose2d truth = facingTag(tag, 1.6, -1.2 + speed * t);
            moved += 0.9 * speed * 0.02; // what odometry reports
            // New positions, not field writes: the field is distanceMeters in 2026, distance in 2027.
            for (int k = 0; k < 4; k++) modules[k] = new SwerveModulePosition(moved, Rotation2d.fromDegrees(90).minus(truth.getRotation()));
            sim.update(truth);
            double now = Timer.getTimestamp();
            estimator.updateWithTime(now, truth.getRotation(), modules);
            vision.addMotion(now, truth.getRotation(), 0, speed);
            var u = vision.periodic();
            for (var a : u.accepted()) types.merge(a.observation().type(), 1, Integer::sum);
            if (i > 50) worst = Math.max(worst, estimator.getEstimatedPosition().getTranslation().getDistance(truth.getTranslation()));
        }
        DriverStationSim.setEnabled(false);
        DriverStationSim.notifyNewData();
        System.out.printf("sim driving: %s; worst estimate error after 1 s: %.3f m%n%s", types, worst, vision.stats().summary());
        assertTrue(vision.stats().all().accepted > 50, vision.stats().summary());
        assertTrue(worst < 0.10, "estimate stays within 10 cm while odometry drifts: " + worst);
    }
}
