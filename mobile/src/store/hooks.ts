/**
 * Typed Redux hooks. Always import these rather than the raw react-redux ones — they carry
 * `RootState` and the thunk-aware `AppDispatch`, so `dispatch(someThunk())` type-checks
 * instead of erroring on a plain-action-only signature.
 *
 * @author Justin Chua
 */
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
