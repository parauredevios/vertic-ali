// src/lib/mock-data.ts
import { DanceClass } from '../types';

export const MOCK_CLASSES: DanceClass[] = [
  {
    id: '1',
    title: 'Pole Débutant',
    startAt: new Date(new Date().setHours(18, 0, 0, 0)), // Aujourd'hui 18h
    endAt: new Date(new Date().setHours(19, 30, 0, 0)),
    maxCapacity: 12,
    attendeesCount: 8,
    instructor: 'Ali',
    priceInCredits: 1,
    location: 'Studio A'
  },
  {
    id: '2',
    title: 'Exotic Pole',
    startAt: new Date(new Date().setHours(20, 0, 0, 0)), // Aujourd'hui 20h
    endAt: new Date(new Date().setHours(21, 30, 0, 0)),
    maxCapacity: 10,
    attendeesCount: 10, // COMPLET !
    instructor: 'Sarah',
    priceInCredits: 1,
    location: 'Studio B'
  },
  {
    id: '3',
    title: 'Souplesse & Stretch',
    startAt: new Date(new Date().setDate(new Date().getDate() + 1)), // Demain
    endAt: new Date(new Date().setDate(new Date().getDate() + 1)), 
    maxCapacity: 15,
    attendeesCount: 3,
    instructor: 'Ali',
    priceInCredits: 1,
    location: 'Studio A'
  }
];