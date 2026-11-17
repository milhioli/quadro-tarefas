import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { POINTER_ACTIVATION } from '../lib/dnd';

/**
 * DndContext com a mesma ativação do App (distância mínima). Sem ela, o
 * PointerSensor padrão começa o arraste no pointerdown e engole o clique.
 */
export function TestDndContext({ children }: { children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: POINTER_ACTIVATION }));
  return <DndContext sensors={sensors}>{children}</DndContext>;
}
