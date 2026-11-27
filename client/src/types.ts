export type Gender = 'FEMALE' | 'MALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY';
export type RelationshipStatus = 'SINGLE' | 'MARRIED' | 'HIDDEN';
export type User = {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  relationshipStatus?: RelationshipStatus | null;
  avatarData?: string | null;
  avatarColor?: string;
};
