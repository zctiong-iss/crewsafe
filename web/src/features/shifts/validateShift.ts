/** @author Tang Chee Seng (with assistance from Claude) */

import type { ShiftCreateRequest } from "@/api/shifts";

export type FieldErrors = Record<string, string>;

export function validateShift(draft: Partial<ShiftCreateRequest>): FieldErrors {
    const errors: FieldErrors = {};

    const { startsAt, endsAt } = draft;

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
        errors.endsAt = "The shift must end after it starts.";
    }
    
    const seen = new Set<string>();
    (draft.assignments ?? []).forEach((assignment, i) => {
        if (assignment.workerId && seen.has(assignment.workerId)) {
            errors[`assignments.${i}.duplicate`] = "This worker is already assigned to the shift.";
        }
        if (assignment.workerId) seen.add(assignment.workerId);

        const day = assignment.acclimatisationDay;
        if (day === undefined || day === null)
            return;

        if (!Number.isInteger(day) || day < 1 || day > 7) {
            errors[`assignments.${i}.acclimatisationDay`] = "Enter a whole number from 1 to 7, or leave it blank."
            }
        }
    );

    return errors;
}