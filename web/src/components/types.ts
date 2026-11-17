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

export interface TopBarProps {
  onGoHome: () => void;
  totalSuspeitasPendentes?: number;
  totalAlertasPendentes?: number;
  onOpenSuspeitas?: () => void;
  onOpenInvestimentos?: () => void;
  onOpenAlertas?: () => void;
}

export type NavTab = 'dashboard' | 'lancamentos' | 'investimentos' | 'suspeitas' | 'importacao' | 'semaforo' | 'compromissos' | 'projecao' | 'cadastros' | 'fases';

export interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  totalSuspeitasPendentes?: number;
}

export interface StatusBadgeProps {
  status: SemaforoStatus | 'INFO' | 'DEV';
  label?: string;
}
