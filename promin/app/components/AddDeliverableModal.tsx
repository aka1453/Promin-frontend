"use client";

import DeliverableCreateModal from "./DeliverableCreateModal";
import { Deliverable } from "../types/deliverable";

type Props = {
  taskId: number;
  existingDeliverables: Deliverable[];
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