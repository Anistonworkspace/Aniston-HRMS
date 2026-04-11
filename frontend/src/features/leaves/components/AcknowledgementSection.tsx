import { CheckCircle } from 'lucide-react';

interface AcknowledgementSectionProps {
  acknowledgements: {
    reviewedTasks: boolean;
    assignedHandover: boolean;
    acceptedVisibility: boolean;
  };
  onChange: (ack: { reviewedTasks: boolean; assignedHandover: boolean; acceptedVisibility: boolean }) => void;
  leaveTypeCode?: string;
}

export default function AcknowledgementSection({ acknowledgements, onChange, leaveTypeCode }: AcknowledgementSectionProps) {
  const isSickLeave = leaveTypeCode?.toUpperCase() === 'SL' || leaveTypeCode?.toUpperCase() === 'SICK';

  const items = [
    {
      key: 'reviewedTasks' as const,
      label: 'I have reviewed the task impact assessment and understand the pending work during my absence.',
      disabled: isSickLeave,
      autoChecked: isSickLeave,
      required: false, // informational only
    },
    {
      key: 'assignedHandover' as const,
      label: 'I have assigned handover and backup responsibilities where needed (optional — backup assignment is not mandatory).',
      disabled: true, // auto-set by wizard — user does not need to check this manually
      autoChecked: true,
      required: false,
    },
    {
      key: 'acceptedVisibility' as const,
      label: 'I understand that critical deadlines and task impact details are visible to my manager and HR.',
      disabled: false,
      autoChecked: false,
      required: true, // only this is required to submit
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <CheckCircle size={14} className="text-emerald-500" /> Acknowledgement
      </h4>
      {isSickLeave && (
        <p className="text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
          Sick leave mode: Task review and handover acknowledgements are automatically accepted.
        </p>
      )}
      {items.map((item) => {
        const checked = item.autoChecked || acknowledgements[item.key];
        return (
          <label key={item.key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            checked ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200 hover:bg-gray-50'
          } ${item.disabled ? 'opacity-70 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={checked}
              disabled={item.disabled}
              onChange={(e) => {
                if (item.disabled) return;
                onChange({ ...acknowledgements, [item.key]: e.target.checked });
              }}
              className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-xs text-gray-700 leading-relaxed">{item.label}</span>
          </label>
        );
      })}
    </div>
  );
}
