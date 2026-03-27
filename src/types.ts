export interface Member {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other' | 'pregnancy' | 'miscarriage' | 'abortion';
  age?: number;
  occupation?: string;
  health?: string;
  healthStatus?: 'healthy' | 'illness' | 'drug-abuse' | 'illness-recovery' | 'drug-recovery' | 'serious-illness-drug' | 'suspected-drug';
  healthText?: string;
  deceased?: boolean;
  deathYear?: string;
  isIndexMember?: boolean; // 발생자 (나)
  isAdopted?: boolean; // 입양 여부
  nationality?: string; // 국적 (KR, VN 등)
  isLivingTogether?: boolean; // 현재 함께 거주 여부 (가구 경계)
  birthOrder?: number; // 출생 순서 (왼쪽에서 오른쪽)
}

export interface Relationship {
  from: string;
  to: string;
  type: 'marriage' | 'divorce' | 'separation' | 'cohabitation' | 'parent-child' | 'emotional' | 'twin';
  emotionalType?: 'close' | 'very-close' | 'conflict' | 'distant' | 'cutoff' | 'violence';
  twinType?: 'identical' | 'fraternal';
  marriageYear?: string;
  divorceYear?: string;
}

export interface GenogramData {
  members: Member[];
  relationships: Relationship[];
  analysis: string;
}
