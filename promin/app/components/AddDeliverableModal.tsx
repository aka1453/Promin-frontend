"use client";

import DeliverableCreateModal from "./DeliverableCreateModal";

type Props = {
  taskId: number;
  existingDeliverables: any[];
  onClose: () => void;
  onCreated: () => void;
};

export default function AddDeliverableModal({
  taskId,
  existingDeliverables,
  onClose,
  onCreated,
}: Props) {
  return (
    <DeliverableCreateModal
      taskId={taskId}
      existingDeliverables={existingDeliverables}
      onClose={onClose}
      onSuccess={onCreated}
    />
  );
}