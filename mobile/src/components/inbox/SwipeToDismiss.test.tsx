import React from "react";
import { Text } from "react-native";
import { render, waitFor } from "@testing-library/react-native";

type SharedValueMock = Readonly<{ value: number }>;
type ActionRenderer = (progress: SharedValueMock, translation: SharedValueMock) => React.ReactNode;
type SwipeableMockProps = Readonly<{
  children: React.ReactNode;
  friction?: number;
  leftThreshold?: number;
  rightThreshold?: number;
  overshootLeft?: boolean;
  overshootRight?: boolean;
  renderLeftActions?: ActionRenderer;
  renderRightActions?: ActionRenderer;
  onSwipeableOpen?: (direction: "left" | "right") => void;
}>;

const mockSwipeProps: { current?: Omit<SwipeableMockProps, "children"> } = {};
const mockInterpolate = jest.fn((_value: number, _inputRange: readonly number[], _outputRange: readonly number[], _extrapolation: string) => 1);

jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const React = require("react");
  const MockSwipeable = ({ children, ...props }: SwipeableMockProps) => {
    mockSwipeProps.current = props;
    const left = props.renderLeftActions;
    const right = props.renderRightActions;
    return React.createElement(React.Fragment, null, children, left?.({ value: 0 }, { value: 48 }), right?.({ value: 0 }, { value: -48 }));
  };
  return { __esModule: true, default: MockSwipeable };
});

jest.mock("react-native-worklets", () => ({}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: "View" },
  Extrapolation: { CLAMP: "clamp" },
  interpolate: (value: number, inputRange: readonly number[], outputRange: readonly number[], extrapolation: string) =>
    mockInterpolate(value, inputRange, outputRange, extrapolation),
  useAnimatedStyle: (factory: () => object) => factory(),
}));

import SwipeToDismiss from "./SwipeToDismiss";

describe("SwipeToDismiss", () => {
  beforeEach(() => {
    mockSwipeProps.current = undefined;
    mockInterpolate.mockClear();
  });

  it("renders children directly when disabled", () => {
    const rendered = render(
      <SwipeToDismiss enabled={false} onDismiss={jest.fn()}>
        <Text>acknowledged</Text>
      </SwipeToDismiss>,
    );

    expect(rendered).toBeTruthy();
  });

  it("configures both directions and dismisses when the supported swipe opens", async () => {
    const onDismiss = jest.fn();
    const rendered = await render(<SwipeToDismiss enabled onDismiss={onDismiss}><Text>acknowledged</Text></SwipeToDismiss>);

    await waitFor(() => expect(mockSwipeProps.current).toBeDefined());
    const swipeProps = mockSwipeProps.current;
    expect(swipeProps).toMatchObject({
      friction: 2,
      leftThreshold: 96,
      rightThreshold: 96,
      overshootLeft: false,
      overshootRight: false,
    });
    expect(swipeProps?.renderLeftActions).toEqual(expect.any(Function));
    expect(swipeProps?.renderRightActions).toEqual(expect.any(Function));
    expect(rendered.getAllByText("inbox.swipeToClear")).toHaveLength(2);
    expect(mockInterpolate).toHaveBeenCalledWith(48, [0, 96], [0, 1], "clamp");
    expect(mockInterpolate).toHaveBeenCalledWith(-48, [-96, 0], [1, 0], "clamp");

    const onSwipeableOpen = swipeProps?.onSwipeableOpen as ((direction: "left" | "right") => void) | undefined;
    expect(onDismiss).not.toHaveBeenCalled();
    onSwipeableOpen?.("left");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    onSwipeableOpen?.("right");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
