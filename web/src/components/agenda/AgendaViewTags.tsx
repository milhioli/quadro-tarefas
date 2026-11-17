import { AGENDA_VIEWS, type AgendaView } from '../../lib/agenda';

export interface AgendaViewTagsProps {
  value: AgendaView;
  onChange: (view: AgendaView) => void;
}

/** Botões em formato de tag que trocam a visualização da agenda. */
export function AgendaViewTags({ value, onChange }: AgendaViewTagsProps) {
  return (
    <div className="view-tags" role="group" aria-label="Visualização">
      {AGENDA_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          className="view-tag"
          aria-pressed={value === view.id}
          title={view.description}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
