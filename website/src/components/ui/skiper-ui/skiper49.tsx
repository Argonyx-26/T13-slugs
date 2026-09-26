'use client';

import { motion } from 'motion/react';
import Image from 'next/image';
import { useRef, useState } from 'react';
import type { Swiper as SwiperInstance } from 'swiper';
import { EffectCoverflow, Keyboard, Mousewheel, Pagination } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import 'swiper/css/pagination';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface CarouselItem {
  src: string;
  alt: string;
}

// Room above and below the slides so the settled one can grow without being clipped
const css = `
  .Carousal_003 {
    width: 100%;
    padding: 28px 0 52px !important;
  }

  .Carousal_003 .swiper-slide {
    width: 240px;
    height: 320px;
  }

  .Carousal_003 .swiper-pagination-bullet {
    background-color: var(--foreground);
  }
`;

/**
 * Coverflow carousel. Once scrolling stops on a slide, that slide enlarges;
 * clicking it calls `onOpen`, clicking a side slide brings it to the centre.
 */
const Carousel_003 = ({
  items,
  className,
  showPagination = false,
  showNavigation = false,
  loop = false,
  spaceBetween = 0,
  onActiveChange,
  onOpen
}: {
  items: CarouselItem[];
  className?: string;
  showPagination?: boolean;
  showNavigation?: boolean;
  loop?: boolean;
  spaceBetween?: number;
  onActiveChange?: (index: number) => void;
  onOpen?: (index: number) => void;
}) => {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState(true);

  const goTo = (index: number) =>
    loop ? swiperRef.current?.slideToLoop(index) : swiperRef.current?.slideTo(index);

  return (
    <motion.div
      initial={{ opacity: 0, translateY: 20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className={cn('relative w-full', className)}
    >
      <style>{css}</style>

      <Swiper
        spaceBetween={spaceBetween}
        effect='coverflow'
        grabCursor
        slidesPerView='auto'
        centeredSlides
        loop={loop}
        slideToClickedSlide={false}
        coverflowEffect={{
          rotate: 40,
          stretch: 0,
          depth: 100,
          modifier: 1,
          slideShadows: true
        }}
        mousewheel={{ forceToAxis: true, thresholdDelta: 10 }}
        keyboard={{ enabled: true, onlyInViewport: true }}
        pagination={showPagination ? { clickable: true } : false}
        className='Carousal_003'
        modules={[EffectCoverflow, Keyboard, Mousewheel, Pagination]}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
        onSlideChange={(swiper) => {
          setActive(swiper.realIndex);
          onActiveChange?.(swiper.realIndex);
        }}
        onTouchStart={() => setSettled(false)}
        onSlideChangeTransitionStart={() => setSettled(false)}
        onTransitionEnd={() => setSettled(true)}
        onTouchEnd={(swiper) => {
          // A tap or a drag that snaps back to the same slide never starts a transition
          if (!swiper.animating) setSettled(true);
        }}
      >
        {items.map((item, index) => {
          const isActive = index === active;
          const enlarged = isActive && settled;
          return (
            <SwiperSlide key={item.src}>
              <button
                type='button'
                onClick={() => (isActive ? onOpen?.(index) : goTo(index))}
                aria-label={isActive ? `Open ${item.alt}` : `Show ${item.alt}`}
                aria-current={isActive || undefined}
                className={cn(
                  'bg-card relative block size-full overflow-hidden rounded-xl border shadow-sm transition-[transform,box-shadow] duration-300 ease-out',
                  enlarged && 'ring-ring/40 scale-110 shadow-xl ring-2'
                )}
              >
                <Image
                  src={item.src}
                  alt={item.alt}
                  fill
                  sizes='240px'
                  unoptimized
                  draggable={false}
                  className='object-cover'
                />
              </button>
            </SwiperSlide>
          );
        })}
      </Swiper>

      {showNavigation && items.length > 1 && (
        <>
          <button
            type='button'
            aria-label='Previous'
            onClick={() => swiperRef.current?.slidePrev()}
            className='bg-background/80 hover:bg-background absolute top-1/2 left-1 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors'
          >
            <Icons.chevronLeft className='size-5' />
          </button>
          <button
            type='button'
            aria-label='Next'
            onClick={() => swiperRef.current?.slideNext()}
            className='bg-background/80 hover:bg-background absolute top-1/2 right-1 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors'
          >
            <Icons.chevronRight className='size-5' />
          </button>
        </>
      )}
    </motion.div>
  );
};

export { Carousel_003 };

/**
 * Skiper 49 Carousel_003 — React + Swiper
 * Built with Swiper.js - Read docs to learn more https://swiperjs.com/
 *
 * License & Usage:
 * - Free to use and modify in both personal and commercial projects.
 * - Attribution to Skiper UI is required when using the free version.
 * - No attribution required with Skiper UI Pro.
 *
 * Author: @gurvinder-singh02
 * Website: https://gxuri.me
 * Twitter: https://x.com/Gur__vi
 */
