export type SemaforoStatus = 'VERDE' | 'AMARELO' | 'VERMELHO';

export interface CardSemaforoProps {
  status: SemaforoStatus;
  title: string;
  subtitle?: string;
  valor?: number | string;
  percentual?: number | string;
  benchmark?: number | string;
  badgeText?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export interface TermometroRendaProps {
  rendaBase: number;
  totalGasto: number;
  label?: string;
  showDetails?: boolean;
}

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export type FaseAtiva = 'FASE_1' | 'FASE_2' | 'FASE_3';

export interface TopBarProps {
  faseAtiva: FaseAtiva;
  onSelectFase?: (fase: FaseAtiva) => void;
}

export type NavTab = 'dashboard' | 'lancamentos' | 'importacao' | 'semaforo' | 'compromissos' | 'cadastros' | 'fases';

export interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenNewTransaction: () => void;
}

export interface StatusBadgeProps {
  status: SemaforoStatus | 'INFO' | 'DEV';
  label?: string;
}
