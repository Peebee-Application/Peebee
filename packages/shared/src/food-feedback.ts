export type FoodItemInsight={averageRating:number|null;ratingCount:number;orderCount:number;recommendCount:number};
export type FoodItemReview={id:string;rating:number;comment:string|null;recommended:boolean;authorName:string;createdAt:string};
export type FoodItemFeedback=FoodItemInsight&{available:boolean;reviews:FoodItemReview[];myReview:FoodItemReview|null;eligibleOrderId:string|null};
