package org.spectrum3847.vision;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.spectrum3847.vision.sink.ClockBridge;

class ClockBridgeTest {
    @Test
    void convertsBothWaysWithAnyEpochs() {
        double[] robot = {100.0};
        double[] phoenix = {5123.25}; // another epoch entirely
        var b = new ClockBridge(() -> phoenix[0], () -> robot[0]);
        assertEquals(5123.20, b.toOther(99.95), 1e-9, "a frame captured 50 ms ago, in Phoenix time");
        assertEquals(99.95, b.fromOther(5123.20), 1e-9);
        robot[0] += 1;
        phoenix[0] += 1; // both clocks advance together: same answer
        assertEquals(5123.20, b.toOther(99.95), 1e-9);
    }
}
