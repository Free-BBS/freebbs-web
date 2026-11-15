/** Aggregate reactions and the current authenticated reader's choices. */
export interface BannerReactions {
  bannerId: string;
  likeCount: number;
  liked: boolean;
  blessingCount: number;
  blessed: boolean;
}

/** Absolute choices make retries safe. A blessing can be sent once, not retracted. */
export interface UpdateBannerReactionsInput {
  liked?: boolean;
  blessed?: true;
}
