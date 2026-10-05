"use client";

import {useId, useState} from "react";
import {Popover} from "radix-ui";
import {ChevronDown, Search, X} from "lucide-react";

type HelperOption = {id: string; name: string; inactive: boolean};

export function HelperMultiSelect({label, options, selectedIds, disabled, onChange}: {
  label: string; options: HelperOption[]; selectedIds: string[]; disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hintId = useId();
  const selected = options.filter(option => selectedIds.includes(option.id));
  const matching = options.filter(option => option.name.toLowerCase().includes(search.trim().toLowerCase()));
  function toggle(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id];
    onChange(next);
  }
  return <div className="helper-multi-select">
    <Popover.Root open={open} onOpenChange={next => {setOpen(next); if (!next) setSearch("");}}>
      <Popover.Trigger asChild><button type="button" className="helper-select-trigger" aria-label={`${label} helpers`} aria-describedby={hintId} disabled={disabled || !options.length}>
        <span>{selected.length ? `${selected.length} ${selected.length === 1 ? "helper" : "helpers"} selected` : "Choose helpers"}</span><ChevronDown size={15} aria-hidden="true"/>
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="helper-select-popover" align="start" sideOffset={6} collisionPadding={12} aria-label={`${label} helper selection`}>
        <div className="helper-select-heading"><strong>Select helpers</strong><span>Choose more than one</span></div>
        <div className="helper-select-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label={`Search ${label.toLowerCase()} helpers`} placeholder="Search volunteers" value={search} onChange={event => setSearch(event.target.value)}/></div>
        <div className="helper-select-options" role="group" aria-label={`${label} volunteers`}>
          {matching.length ? matching.map(option => {
            const checked = selectedIds.includes(option.id);
            return <label key={option.id} className={checked ? "is-selected" : ""}><input type="checkbox" checked={checked} disabled={disabled || (!checked && (option.inactive || selectedIds.length >= 30))} onChange={() => toggle(option.id)}/><span>{option.name}{option.inactive && <small>Inactive</small>}</span></label>;
          }) : <p className="helper-select-empty">No matching volunteers.</p>}
        </div>
        <div className="helper-select-footer"><span>{selectedIds.length}/30 selected</span><Popover.Close asChild><button type="button" className="text-action">Done</button></Popover.Close></div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {!!selected.length && <div className="helper-selected-names" aria-label={`${label} selected helpers`}>{selected.map(option => <span className="helper-selected-chip" key={option.id}><span>{option.name}</span><button type="button" aria-label={`Remove ${option.name} from ${label.toLowerCase()} helpers`} disabled={disabled} onClick={() => toggle(option.id)}><X size={12} aria-hidden="true"/></button></span>)}</div>}
    <small className="inline-field-hint" id={hintId}>{options.length ? "Select multiple helpers · changes save automatically" : "Add active volunteers to assign helpers."}</small>
  </div>;
}
