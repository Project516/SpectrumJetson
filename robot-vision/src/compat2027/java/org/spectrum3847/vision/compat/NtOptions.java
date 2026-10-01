package org.spectrum3847.vision.compat;

import org.wpilib.networktables.PubSubOption;

/** NetworkTables subscription options (WPILib 2027: PubSubOption.SEND_ALL). */
public final class NtOptions {
    private NtOptions() {}

    /** Every value, queued (up to {@code queue}), sampled every 10 ms: for per-frame data. */
    public static PubSubOption[] everyValue(int queue) {
        return new PubSubOption[] {PubSubOption.SEND_ALL, PubSubOption.pollStorage(queue), PubSubOption.periodic(0.01)};
    }
}
