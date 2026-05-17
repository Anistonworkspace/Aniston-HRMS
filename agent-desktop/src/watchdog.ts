/**
 * Windows Watchdog — registers the Aniston Support agent as a Windows Task Scheduler task.
 *
 * When the task is registered:
 *   - Runs at every user login (even if the user manually killed it)
 *   - Restarts automatically up to 3 times if it exits (covers Task Manager kills)
 *   - Runs hidden (no taskbar window, no console)
 *
 * This does NOT replace auto-launch (which handles the first startup after install).
 * The scheduled task fires AFTER auto-launch, so both are complementary.
 *
 * On non-Windows platforms this is a no-op.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TASK_NAME = 'AnistonSupportAgent';

/**
 * Register (or update) the watchdog scheduled task.
 * Safe to call on every launch — if the task already exists it is updated.
 * Errors are logged but never thrown (non-critical path).
 */
export async function registerWatchdog(exePath: string): Promise<void> {
  if (process.platform !== 'win32') return;

  // Build PowerShell script to register the task:
  //   - Trigger: AtLogon for the current user
  //   - Action: run the exe hidden
  //   - RestartCount: 3 attempts on failure, 1-minute interval
  //   - ExecutionTimeLimit: none (runs indefinitely)
  //   - RunOnlyIfNetworkAvailable: false (we want it to start offline too)
  const psScript = `
$action = New-ScheduledTaskAction -Execute '${exePath.replace(/'/g, "''")}' -WorkingDirectory '${exePath.replace(/\\[^\\]+$/, '').replace(/'/g, "''")}'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet \`
  -ExecutionTimeLimit 0 \`
  -RestartCount 3 \`
  -RestartInterval (New-TimeSpan -Minutes 1) \`
  -MultipleInstances IgnoreNew \`
  -StartWhenAvailable \`
  -RunOnlyIfNetworkAvailable $false
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Aniston HRMS Support Agent — auto-restart watchdog'
Register-ScheduledTask -TaskName '${TASK_NAME}' -InputObject $task -Force | Out-Null
Write-Output 'WATCHDOG_OK'
`.trim();

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden',
      '-Command', psScript,
    ], { timeout: 15_000 });

    if (stdout.includes('WATCHDOG_OK')) {
      console.log('[Watchdog] Scheduled task registered successfully');
    } else {
      console.warn('[Watchdog] Unexpected output:', stdout.trim());
    }
  } catch (err) {
    // Non-critical — agent still works, just won't auto-restart after kill
    console.warn('[Watchdog] Failed to register scheduled task (non-critical):', (err as Error).message);
  }
}

/**
 * Remove the watchdog task — called during logout/uninstall.
 * Errors are silently ignored.
 */
export async function unregisterWatchdog(): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await execFileAsync('powershell.exe', [
      '-NonInteractive', '-NoProfile', '-WindowStyle', 'Hidden',
      '-Command', `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue`,
    ], { timeout: 10_000 });
    console.log('[Watchdog] Scheduled task removed');
  } catch {
    // Silently ignore — task may not exist
  }
}
