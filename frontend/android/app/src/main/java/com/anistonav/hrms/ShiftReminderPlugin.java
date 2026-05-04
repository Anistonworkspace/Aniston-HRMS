package com.anistonav.hrms;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Schedules a local notification 15 minutes before the employee's shift start time.
 * Cancels automatically when the employee checks in (call cancel() from JS).
 *
 * JS usage:
 *   const ShiftReminder = registerPlugin('ShiftReminder');
 *   // shiftStartEpochMs: Unix timestamp of shift start in milliseconds
 *   await ShiftReminder.schedule({ shiftStartEpochMs: 1234567890000, shiftName: 'Morning Shift' });
 *   await ShiftReminder.cancel();
 */
@CapacitorPlugin(name = "ShiftReminder")
public class ShiftReminderPlugin extends Plugin {

    private static final String TAG = "ShiftReminderPlugin";
    public static final String CHANNEL_ID = "aniston_shift_reminder";
    private static final int NOTIFICATION_ID = 2001;
    private static final int ALARM_REQUEST_CODE = 3001;
    private static final long REMIND_BEFORE_MS = 15 * 60 * 1000L; // 15 min before shift

    @PluginMethod
    public void schedule(PluginCall call) {
        long shiftStartEpochMs = call.getLong("shiftStartEpochMs", 0L);
        String shiftName = call.getString("shiftName", "your shift");

        if (shiftStartEpochMs <= 0) {
            call.reject("shiftStartEpochMs is required");
            return;
        }

        long triggerAt = shiftStartEpochMs - REMIND_BEFORE_MS;
        long now = System.currentTimeMillis();

        if (triggerAt <= now) {
            // Shift starts in less than 15 min or already started — fire immediately if < 2h ago
            if (now - shiftStartEpochMs < 2 * 60 * 60 * 1000L) {
                fireNotificationNow(getContext(), shiftName);
            }
            JSObject r = new JSObject();
            r.put("scheduled", false);
            r.put("reason", "shift starts too soon");
            call.resolve(r);
            return;
        }

        ensureChannel(getContext());
        Context ctx = getContext();

        Intent intent = new Intent(ctx, ShiftReminderReceiver.class);
        intent.putExtra("shiftName", shiftName);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, ALARM_REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) { call.reject("AlarmManager unavailable"); return; }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            Log.d(TAG, "Shift reminder scheduled for " + triggerAt + " (" + shiftName + ")");
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }

        JSObject r = new JSObject();
        r.put("scheduled", true);
        r.put("triggerAt", triggerAt);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, ShiftReminderReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, ALARM_REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pi);

        // Also dismiss the notification if it was already shown
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);

        Log.d(TAG, "Shift reminder cancelled");
        call.resolve();
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Shift Reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Reminds you 15 minutes before your shift starts");
            ch.enableVibration(true);
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    static void fireNotificationNow(Context ctx, String shiftName) {
        ensureChannel(ctx);
        Intent openApp = new Intent(ctx, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Shift starting soon — " + shiftName)
                .setContentText("Your shift starts in 15 minutes. Remember to check in!")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openPi)
                .setVibrate(new long[]{0, 500, 200, 500});

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, builder.build());
        Log.d(TAG, "Shift reminder notification fired for: " + shiftName);
    }

    /** BroadcastReceiver woken by AlarmManager to fire the reminder notification. */
    public static class ShiftReminderReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String shiftName = intent.getStringExtra("shiftName");
            if (shiftName == null) shiftName = "your shift";
            fireNotificationNow(context, shiftName);
        }
    }
}
