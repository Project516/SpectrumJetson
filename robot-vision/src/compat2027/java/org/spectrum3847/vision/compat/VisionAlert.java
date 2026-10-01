package org.spectrum3847.vision.compat;

import org.wpilib.driverstation.Alert;

/** An alert on the dashboard (WPILib 2027: Alert with Level). */
public final class VisionAlert {
    public enum Level {
        ERROR,
        WARNING,
        INFO
    }

    private final Alert alert;

    public VisionAlert(String group, String text, Level level) {
        alert =
                new Alert(
                        group,
                        text,
                        switch (level) {
                            case ERROR -> Alert.Level.HIGH;
                            case WARNING -> Alert.Level.MEDIUM;
                            case INFO -> Alert.Level.LOW;
                        });
    }

    public void set(boolean active) {
        alert.set(active);
    }

    public void setText(String text) {
        alert.setText(text);
    }
}
