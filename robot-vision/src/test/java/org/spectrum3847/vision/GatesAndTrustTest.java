package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;
import static org.spectrum3847.vision.TestField.*;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Pose3d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Rotation3d;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.gate.GateContext;
import org.spectrum3847.vision.gate.GateSet;
import org.spectrum3847.vision.gate.Gates;
import org.spectrum3847.vision.heading.RobotMotionHistory;
import org.spectrum3847.vision.observation.PoseObservation;
import org.spectrum3847.vision.solve.Solvers;
import org.spectrum3847.vision.trust.TrustModel;

class GatesAndTrustTest {
    static GateContext ctx(double now, RobotMotionHistory m, Pose2d estimate, boolean enabled) {
        return new GateContext(now, FIELD, m, estimate, enabled, Set.of());
    }

    static RobotMotionHistory still(double t, double headingDeg) {
        var m = new RobotMotionHistory();
        m.add(t - 0.2, Rotation2d.fromDegrees(headingDeg), 0, 0);
        m.add(t, Rotation2d.fromDegrees(headingDeg), 0, 0);
        return m;
    }

    static PoseObservation multiTagAt(Pose2d robot, double t) {
        var f = camera("c").frame(FIELD, new Pose3d(robot), FRONT, t);
        return Solvers.standard().solve(f, FRONT, FIELD, null).get(0);
    }

    @Test
    void recommendedAcceptsAGoodFrame() {
        var robot = facingWall(3, 4);
        var o = multiTagAt(robot, 1.0);
        var v = Gates.recommended().judge(o, ctx(1.03, still(1.0, 180), robot, true));
        assertTrue(v.accepted(), v.gate() + ": " + v.reason());
    }

    @Test
    void eachGateRejectsWhatItShould() {
        var robot = facingWall(3, 4);
        var o = multiTagAt(robot, 1.0);
        var m = still(1.0, 180);
        assertEquals("maxAge", Gates.recommended().judge(o, ctx(2.0, m, robot, true)).gate());
        assertEquals("notFromFuture", Gates.recommended().judge(o, ctx(0.5, m, robot, true)).gate());
        var excludedCtx = new GateContext(1.03, FIELD, m, robot, true, Set.of(2));
        assertEquals("excludedTags", Gates.recommended().judge(o, excludedCtx).gate());
        // A gyro reading 40° off: the multi-tag heading disagrees.
        assertEquals("headingAgreesWithGyro", Gates.recommended().judge(o, ctx(1.03, still(1.0, 220), robot, true)).gate());
        // Spinning fast.
        var spin = new RobotMotionHistory();
        spin.add(0.8, Rotation2d.fromDegrees(180), 6, 0);
        spin.add(1.1, Rotation2d.fromDegrees(180), 6, 0);
        assertEquals("maxYawRate", Gates.recommended().judge(o, ctx(1.03, spin, robot, true)).gate());
        // Far from the estimate while enabled; fine while disabled.
        var far = new Pose2d(8, 2, Rotation2d.fromDegrees(180));
        assertEquals("innovation", Gates.recommended().judge(o, ctx(1.03, m, far, true)).gate());
        assertTrue(Gates.recommended().judge(o, ctx(1.03, m, far, false)).accepted());
    }

    @Test
    void geometryGates() {
        var base = multiTagAt(facingWall(3, 4), 1.0);
        var c = ctx(1.03, new RobotMotionHistory(), null, true);
        var outside = with(base, new Pose3d(-2, 4, 0, new Rotation3d(0, 0, Math.PI)));
        assertEquals("insideField", GateSet.of(Gates.insideField(0.5)).judge(outside, c).gate());
        var flying = with(base, new Pose3d(3, 4, 0.8, new Rotation3d(0, 0, Math.PI)));
        assertEquals("maxHeight", GateSet.of(Gates.maxHeight(0.3)).judge(flying, c).gate());
        var tilted = with(base, new Pose3d(3, 4, 0, new Rotation3d(Math.toRadians(30), 0, Math.PI)));
        assertEquals("maxTilt", GateSet.of(Gates.maxTilt(20)).judge(tilted, c).gate());
        assertEquals("maxDistance", GateSet.of(Gates.maxDistance(1, 2)).judge(base, c).gate());
    }

    @Test
    void uniqueFramesOncePerFrame() {
        var o = multiTagAt(facingWall(3, 4), 1.0);
        var gates = GateSet.of(Gates.uniqueFrames());
        var driver = new GateSet.Driver(gates);
        var c = ctx(1.03, new RobotMotionHistory(), null, true);
        driver.beginLoop(c);
        assertTrue(driver.judge(o, c).accepted());
        assertTrue(driver.judge(o, c).accepted(), "another candidate from the same frame, same loop");
        driver.beginLoop(c);
        assertEquals("uniqueFrames", driver.judge(o, c).gate(), "the same frame in a later loop");
    }

    @Test
    void innovationGivesWayToAgreeingFrames() {
        var gates = GateSet.of(Gates.innovation(new Gates.InnovationConfig()));
        var driver = new GateSet.Driver(gates);
        var wrongEstimate = facingWall(6, 2); // the robot was pushed; vision says (3, 4)
        int accepted = -1;
        for (int i = 0; i < 5; i++) {
            double t = 1 + 0.05 * i;
            var c = ctx(t + 0.03, new RobotMotionHistory(), wrongEstimate, true);
            driver.beginLoop(c);
            if (driver.judge(multiTagAt(facingWall(3, 4), t), c).accepted()) {
                accepted = i;
                break;
            }
        }
        assertEquals(2, accepted, "the 3rd agreeing frame in a row wins");
    }

    @Test
    void trustFallsWithDistanceAndSingleTagHeadingIsIgnored() {
        var trust = TrustModel.recommended();
        var c = ctx(1.03, new RobotMotionHistory(), null, true);
        var near = multiTagAt(facingWall(2.2, 4), 1.0); // close enough, and all three tags in view
        var far = multiTagAt(facingWall(4.5, 4), 1.0);
        double nearXy = trust.stdDevs(near, c, 1).get(0, 0);
        double farXy = trust.stdDevs(far, c, 1).get(0, 0);
        assertTrue(farXy > nearXy * 3, "distance squared: " + nearXy + " vs " + farXy);
        assertTrue(trust.stdDevs(near, c, 2).get(0, 0) > nearXy * 1.99, "camera factor");
        var cam = camera("c");
        cam.multiTag = false;
        var single = Solvers.singleTag(new Solvers.SingleTagConfig().preferTrig(false))
                .solve(cam.frame(FIELD, new Pose3d(facingWall(2.5, 4)), FRONT, 1.0), FRONT, FIELD, null).get(0);
        assertTrue(trust.stdDevs(single, c, 1).get(2, 0) > 1e5, "single-tag heading ignored");
        assertTrue(trust.stdDevs(near, c, 1).get(2, 0) < 1, "multi-tag heading used");
    }

    @Test
    void gateSetEditing() {
        var g = Gates.recommended().without("innovation").replace(Gates.maxDistance(2, 3));
        assertTrue(g.gates().stream().noneMatch(x -> x.name().equals("innovation")));
        assertEquals(List.of("maxDistance"), g.gates().stream().map(x -> x.name()).filter(n -> n.equals("maxDistance")).toList());
    }

    static PoseObservation with(PoseObservation o, Pose3d robot) {
        return new PoseObservation(robot, o.timestampSeconds(), o.type(), o.tagIds(), o.averageDistanceMeters(),
                o.minDistanceMeters(), o.ambiguity(), o.reprojErrPx(), o.minEdgePx(), o.minDecisionMargin(),
                o.headingDisagreementRad(), o.frame());
    }
}
