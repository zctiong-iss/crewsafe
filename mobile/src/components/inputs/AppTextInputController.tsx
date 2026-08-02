/**
 * `AppTextInput` bound to react-hook-form.
 *
 * Screens should use this rather than the bare input, so that validation state, error text
 * and the field value all come from one place. The error string arrives already translated
 * — the yup schemas are built inside the component with `t(...)`, so a language change
 * re-renders them (see `SignInScreen`). Nothing here holds an English default.
 */
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { forwardRef } from "react";
import type { TextInput } from "react-native";
import AppTextInput, { type AppTextInputProps } from "./AppTextInput";

interface AppTextInputControllerProps<T extends FieldValues>
  extends Omit<AppTextInputProps, "value" | "onChangeText" | "errorMessage"> {
  control: Control<T>;
  name: Path<T>;
}

function AppTextInputControllerInner<T extends FieldValues>(
  { control, name, ...rest }: AppTextInputControllerProps<T>,
  ref: React.ForwardedRef<TextInput>,
) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <AppTextInput
          ref={ref}
          value={value ?? ""}
          onChangeText={onChange}
          onBlur={onBlur}
          errorMessage={error?.message}
          {...rest}
        />
      )}
    />
  );
}

/**
 * Cast is needed because `forwardRef` erases the generic. This is the standard workaround
 * and keeps `<AppTextInputController<FormData> ... />` type-safe at every call site.
 */
const AppTextInputController = forwardRef(AppTextInputControllerInner) as <T extends FieldValues>(
  props: AppTextInputControllerProps<T> & { ref?: React.ForwardedRef<TextInput> },
) => ReturnType<typeof AppTextInputControllerInner>;

export default AppTextInputController;
