// src/components/ClassCard.tsx
import React from 'react';
import type { DanceClass } from '../types'; // On importe le type depuis le dictionnaire
import { User, MapPin } from 'lucide-react';

interface ClassCardProps {
  info: DanceClass;
  onBook?: (id: string) => void; // J'ai ajouté l'option de cliquer
}

export const ClassCard: React.FC<ClassCardProps> = ({ info, onBook }) => {
  const isFull = info.attendeesCount >= info.maxCapacity;
  
  // Petit formatage de l'heure
  const timeStr = info.startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 mb-4 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="font-bold text-lg text-gray-800">{info.title}</h3>
          <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {info.instructor}
          </span>
        </div>
        <span className="text-xl font-bold text-amber-600">{timeStr}</span>
      </div>
      
      <div className="flex items-center gap-4 text-sm text-gray-500 mb-4 mt-3">
        <span className="flex items-center gap-1">
            <User size={16}/> {info.attendeesCount}/{info.maxCapacity}
        </span>
        <span className="flex items-center gap-1">
            <MapPin size={16}/> {info.location}
        </span>
      </div>

      <button 
        onClick={() => onBook && onBook(info.id)}
        disabled={isFull} 
        className={`w-full py-2.5 rounded-lg font-bold text-white transition-colors
          ${isFull
            ? 'bg-gray-300 cursor-not-allowed'
            : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700'
          }`}
      >
        {isFull ? 'Cours Complet' : 'Réserver ce cours'}
      </button>
    </div>
  );
};