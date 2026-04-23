import { useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../../app/store';
import { Role } from '@aniston/shared';
import {
  useGetCompOffBalanceQuery,
  useGetCompOffCreditsQuery,
  useGetOrgCompOffCreditsQuery,
  useGrantCompOffMutation,
} from '../attendanceApi';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Gift, Clock, CheckCircle, XCircle, AlertTriangle, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '../../../hooks/use-toast';

function statusBadge(status: string) {
  if (status === 'AVAILABLE') return <Badge className="bg-green-100 text-green-800 border-green-200">Available</Badge>;
  if (status === 'USED')      return <Badge className="bg-gray-100 text-gray-600 border-gray-200">Used</Badge>;
  if (status === 'EXPIRED')   return <Badge className="bg-red-100 text-red-700 border-red-200">Expired</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd MMM yyyy'); } catch { return d; }
}

export function CompOffTab() {
  const user = useSelector((s: RootState) => s.auth.user);
  const isHR = user?.role && [Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER].includes(user.role as Role);

  const { data: balanceData } = useGetCompOffBalanceQuery();
  const { data: creditsData, isLoading: creditsLoading } = useGetCompOffCreditsQuery();
  const { data: orgData, isLoading: orgLoading } = useGetOrgCompOffCreditsQuery({}, { skip: !isHR });

  const [grantCompOff] = useGrantCompOffMutation();
  const [showGrant, setShowGrant] = useState(false);
  const [grantForm, setGrantForm] = useState({
    employeeId: '', earnedDate: '', hoursWorked: '8', notes: '', expiryMonths: '3',
  });
  const [granting, setGranting] = useState(false);

  const balance = balanceData?.data?.balance ?? 0;
  const myCredits = creditsData?.data ?? [];
  const orgCredits = orgData?.data ?? [];

  async function handleGrant() {
    if (!grantForm.employeeId || !grantForm.earnedDate) {
      toast({ title: 'Validation error', description: 'Employee ID and earned date are required', variant: 'destructive' });
      return;
    }
    setGranting(true);
    try {
      await grantCompOff({
        employeeId: grantForm.employeeId,
        earnedDate: grantForm.earnedDate,
        hoursWorked: Number(grantForm.hoursWorked),
        notes: grantForm.notes || undefined,
        expiryMonths: Number(grantForm.expiryMonths),
      }).unwrap();
      toast({ title: 'Comp-off granted', description: 'Credit created successfully' });
      setShowGrant(false);
      setGrantForm({ employeeId: '', earnedDate: '', hoursWorked: '8', notes: '', expiryMonths: '3' });
    } catch (e: any) {
      toast({ title: 'Failed to grant', description: e?.data?.error?.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Balance Card — employee view */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="layer-card border-green-200 bg-green-50/50">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
              <Gift className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Available Balance</p>
              <p className="text-3xl font-bold font-mono text-green-700">{balance}</p>
              <p className="text-xs text-gray-400">comp-off days</p>
            </div>
          </CardContent>
        </Card>
        <Card className="layer-card border-blue-200 bg-blue-50/50">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Earned</p>
              <p className="text-3xl font-bold font-mono text-blue-700">{myCredits.length}</p>
              <p className="text-xs text-gray-400">all-time credits</p>
            </div>
          </CardContent>
        </Card>
        <Card className="layer-card border-amber-200 bg-amber-50/50">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Used / Expired</p>
              <p className="text-3xl font-bold font-mono text-amber-700">
                {myCredits.filter(c => c.status !== 'AVAILABLE').length}
              </p>
              <p className="text-xs text-gray-400">credits consumed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My Credits */}
      <Card className="layer-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gift className="w-4 h-4 text-indigo-500" /> My Comp-Off Credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          {creditsLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
          ) : myCredits.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No comp-off credits yet. Work on a weekly off-day to earn one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-2 font-medium">Earned Date</th>
                    <th className="text-left py-2 font-medium">Hours Worked</th>
                    <th className="text-left py-2 font-medium">Expires</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="text-left py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {myCredits.map((c: any) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50/50">
                      <td className="py-2 font-mono text-xs">{fmtDate(c.earnedDate)}</td>
                      <td className="py-2 font-mono">{c.hoursWorked}h</td>
                      <td className="py-2 font-mono text-xs">
                        {fmtDate(c.expiryDate)}
                        {c.status === 'AVAILABLE' && new Date(c.expiryDate) < new Date(Date.now() + 7 * 864e5) && (
                          <span className="ml-1 text-amber-500"><AlertTriangle className="w-3 h-3 inline" /> Soon</span>
                        )}
                      </td>
                      <td className="py-2">{statusBadge(c.status)}</td>
                      <td className="py-2 text-gray-500 text-xs">{c.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* HR / Admin: Org view + grant button */}
      {isHR && (
        <Card className="layer-card">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Gift className="w-4 h-4 text-purple-500" /> All Employee Comp-Off Credits
            </CardTitle>
            <Button size="sm" onClick={() => setShowGrant(true)} className="btn-primary gap-1">
              <Plus className="w-4 h-4" /> Grant Credit
            </Button>
          </CardHeader>
          <CardContent>
            {orgLoading ? (
              <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
            ) : orgCredits.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No comp-off credits in the org yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-2 font-medium">Employee</th>
                      <th className="text-left py-2 font-medium">Earned</th>
                      <th className="text-left py-2 font-medium">Hours</th>
                      <th className="text-left py-2 font-medium">Expires</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgCredits.map((c: any) => (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50/50">
                        <td className="py-2">
                          <span className="font-medium">{c.employee?.firstName} {c.employee?.lastName}</span>
                          <span className="text-gray-400 text-xs ml-1">({c.employee?.employeeCode})</span>
                        </td>
                        <td className="py-2 font-mono text-xs">{fmtDate(c.earnedDate)}</td>
                        <td className="py-2 font-mono">{c.hoursWorked}h</td>
                        <td className="py-2 font-mono text-xs">{fmtDate(c.expiryDate)}</td>
                        <td className="py-2">{statusBadge(c.status)}</td>
                        <td className="py-2 text-gray-500 text-xs">{c.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grant Dialog */}
      <Dialog open={showGrant} onOpenChange={setShowGrant}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-500" /> Grant Comp-Off Credit
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Employee ID</Label>
              <Input
                placeholder="Employee UUID"
                value={grantForm.employeeId}
                onChange={e => setGrantForm(f => ({ ...f, employeeId: e.target.value }))}
              />
              <p className="text-xs text-gray-400">Paste the employee's UUID from their profile</p>
            </div>
            <div className="space-y-1">
              <Label>Earned Date</Label>
              <Input
                type="date"
                value={grantForm.earnedDate}
                onChange={e => setGrantForm(f => ({ ...f, earnedDate: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Hours Worked</Label>
                <Input
                  type="number" min="1" max="24" step="0.5"
                  value={grantForm.hoursWorked}
                  onChange={e => setGrantForm(f => ({ ...f, hoursWorked: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Expires After (months)</Label>
                <Input
                  type="number" min="1" max="12"
                  value={grantForm.expiryMonths}
                  onChange={e => setGrantForm(f => ({ ...f, expiryMonths: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="e.g. Worked on Sunday 20-Apr for project deployment"
                value={grantForm.notes}
                onChange={e => setGrantForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGrant(false)}>Cancel</Button>
            <Button onClick={handleGrant} disabled={granting} className="btn-primary">
              {granting ? 'Granting…' : 'Grant Comp-Off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
