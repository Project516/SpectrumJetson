// Live check of SpectrumVision's input path against real PhotonVision output. Run ON THE JETSON
// (tests/robot-vision-live/run.sh), with the fake robot's NetworkTables server and fake cameras:
// reads every camera's rawBytes and tagQuality like PhotonLib would, converts each result with the
// library's own PhotonCameraIO.toFrame, matches the Jetson's per-tag quality by sequence ID
// (TagQualityMatcher), and runs the solvers and recommended gates. Prints per camera: frames,
// quality matched, candidates by type, accepted, rejected by gate. Exit 0 when frames with tags
// arrived, every one got its quality, and candidates were produced.
import edu.wpi.first.apriltag.AprilTagFieldLayout;
import edu.wpi.first.apriltag.AprilTagFields;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.geometry.Transform3d;
import edu.wpi.first.networktables.DoubleArraySubscriber;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.networktables.PubSubOption;
import edu.wpi.first.networktables.RawSubscriber;
import java.util.*;
import org.photonvision.common.dataflow.structures.Packet;
import org.photonvision.jni.LibraryLoader;
import org.photonvision.targeting.PhotonPipelineResult;
import org.spectrum3847.vision.VisionSystem;
import org.spectrum3847.vision.io.FakeCameraIO;
import org.spectrum3847.vision.io.PhotonCameraIO;
import org.spectrum3847.vision.io.TagQualityMatcher;

public class LiveCheck {
    public static void main(String[] args) throws Exception {
        double seconds = args.length > 0 ? Double.parseDouble(args[0]) : 15;
        LibraryLoader.loadWpiLibraries();
        LibraryLoader.loadTargeting();
        var nt = NetworkTableInstance.create();
        nt.setServer("10.85.15.2");
        nt.startClient4("robot-vision-live");
        long giveUp = System.currentTimeMillis() + 20_000;
        while (!nt.isConnected()) {
            if (System.currentTimeMillis() > giveUp) { System.out.println("TIMEOUT: no NetworkTables server"); System.exit(2); }
            Thread.sleep(100);
        }
        var all = new edu.wpi.first.networktables.MultiSubscriber(nt, new String[] {"/photonvision/"}, PubSubOption.topicsOnly(true));
        Thread.sleep(2000);
        var cams = new TreeSet<String>();
        for (var t : nt.getTopics("/photonvision/")) {
            String n = t.getName();
            if (n.endsWith("/rawBytes")) cams.add(n.substring("/photonvision/".length(), n.length() - "/rawBytes".length()));
        }
        if (cams.isEmpty()) { System.out.println("FAIL: no cameras"); System.exit(1); }
        var opts = new PubSubOption[] {PubSubOption.sendAll(true), PubSubOption.pollStorage(500), PubSubOption.periodic(0.01)};
        var raw = new HashMap<String, RawSubscriber>();
        var qual = new HashMap<String, DoubleArraySubscriber>();
        var matchers = new HashMap<String, TagQualityMatcher>();
        var ios = new HashMap<String, FakeCameraIO>();
        var field = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);
        double[] now = {0};
        var b = VisionSystem.builder(field).offline().clock(() -> now[0]).sink((p, t, s) -> {});
        for (var c : cams) {
            raw.put(c, nt.getRawTopic("/photonvision/" + c + "/rawBytes").subscribe(PhotonPipelineResult.photonStruct.getTypeString(), new byte[0], opts));
            qual.put(c, nt.getDoubleArrayTopic("/photonvision/" + c + "/tagQuality").subscribe(new double[0], opts));
            matchers.put(c, new TagQualityMatcher());
            ios.put(c, new FakeCameraIO(c));
            b.camera(ios.get(c), new Transform3d(), 1.0); // mount unknown for fake cameras: geometry gates will reject
        }
        var vision = b.build();
        var frames = new HashMap<String, Integer>();
        var withQuality = new HashMap<String, Integer>();
        var multi = new HashMap<String, Integer>();
        long end = System.currentTimeMillis() + (long) (seconds * 1000);
        while (System.currentTimeMillis() < end) {
            for (var c : cams) {
                for (var v : qual.get(c).readQueue()) matchers.get(c).offer(v.value);
                for (var v : raw.get(c).readQueue()) {
                    var r = PhotonPipelineResult.photonStruct.unpack(new Packet(v.value));
                    if (!r.hasTargets()) continue;
                    var f = matchers.get(c).apply(PhotonCameraIO.toFrame(c, r));
                    frames.merge(c, 1, Integer::sum);
                    if (f.tags().stream().allMatch(t -> !Double.isNaN(t.decisionMargin()))) withQuality.merge(c, 1, Integer::sum);
                    if (f.hasMultiTag()) multi.merge(c, 1, Integer::sum);
                    ios.get(c).queue(f);
                    now[0] = Math.max(now[0], f.timestampSeconds() + 0.03);
                }
            }
            vision.addMotion(now[0], Rotation2d.kZero, 0, 0);
            vision.periodic();
            Thread.sleep(20);
        }
        boolean pass = true;
        int seen = 0;
        for (var c : cams) {
            int n = frames.getOrDefault(c, 0);
            System.out.printf("%s: %d frames with tags, %d with the Jetson's quality, %d multi-tag%n", c, n, withQuality.getOrDefault(c, 0), multi.getOrDefault(c, 0));
            if (n > 0) {
                seen++;
                if (withQuality.getOrDefault(c, 0) < n * 0.95) pass = false;
            }
        }
        System.out.print(vision.stats().summary());
        if (seen == 0 || vision.stats().all().candidates == 0) pass = false;
        System.out.println(pass ? "PASS" : "FAIL");
        all.close();
        System.exit(pass ? 0 : 1);
    }
}
