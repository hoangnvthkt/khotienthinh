import React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

// Popover theo mẫu shadcn/ui (Radix): mở / đóng, bấm ngoài, Esc, trả focus về nút mở đều do Radix lo.
// Không dùng Portal: nội dung nằm trong .vcc nên ăn theo token sáng / tối của Trung tâm điều hành.

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, collisionPadding = 12, ...props }, ref) => (
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    collisionPadding={collisionPadding}
    className={`vcc-popover${className ? ` ${className}` : ''}`}
    {...props}
  />
));
PopoverContent.displayName = 'PopoverContent';
