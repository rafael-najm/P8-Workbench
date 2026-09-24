import type { ComponentType } from 'react';
import type { IconName } from '../components/Icon';
import type { PanelId } from '../../store/ui';

export interface PanelDef {
  id: PanelId;
  title: string;
  icon: IconName;
  /** e.g. "Ctrl+1" */
  shortcut?: string;
  component: ComponentType;
}

/** Filled in by each panel module (so milestones can add panels independently). */
export const PANELS = new Map<PanelId, PanelDef>();

export function registerPanel(def: PanelDef): void {
  PANELS.set(def.id, def);
}
