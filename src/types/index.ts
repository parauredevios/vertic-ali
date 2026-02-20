export type UserRole = 'student' | 'admin';
export type UserLevel = 'debutant' | 'inter' | 'avance';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  credits: number;
  phone?: string;
  level?: UserLevel;
  emergencyContact?: string;
  photoURL?: string;
}

export interface DanceClass {
  id: string;
  title: string;
  description?: string;
  startAt: Date; // Sera converti depuis Timestamp Firebase
  endAt: Date;
  maxCapacity: number;
  attendeesCount: number;
  instructor: string; // ex: "Ali"
  priceInCredits: number;
  location?: string;
  imageId?: string; // Pour une future image de cours
}

export type BookingStatus = 'confirmed' | 'cancelled' | 'waitlist';

export interface Booking {
  id: string;
  userId: string;
  classId: string;
  status: BookingStatus;
  bookedAt: Date;
  isLateCancel: boolean; // True si annulé < 24h avant
}

export type TransactionType = 'purchase' | 'usage' | 'adjustment';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  description: string;
  amount: number; // En euros (si achat)
  creditsChange: number; // +10 ou -1
  date: Date;
}