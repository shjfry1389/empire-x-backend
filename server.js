const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});
const auth = require("./middleware/auth");
const admin = require("./middleware/admin");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");

const bcrypt = require("bcrypt");
require("dotenv").config();

const supabase = require("./supabase");

const app = express();


app.use(
  cors({
    origin: [
      "https://empire-x-nine.vercel.app",
      "https://castle-x.vercel.app",
      "https://castle-x-frontend.vercel.app",
      "http://localhost:5173"
    ],
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    app: "Castle X",
    status: "online",
  });
});

// ثبت نام
app.post("/api/auth/register", async (req, res) => {
  try {
    let { username, display_name, password } = req.body;

    username = username?.trim();
    display_name = display_name?.trim();

    if (!username || !display_name || !password) {
      return res.status(400).json({
        error: "همه فیلدها الزامی هستند",
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        error: "نام کاربری باید حداقل ۳ کاراکتر باشد",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "رمز عبور باید حداقل ۶ کاراکتر باشد",
      });
    }

    const { data: existingUser, error: existingError } = await supabase
      .from("users")
      .select("id, username")
      .ilike("username", username)
      .maybeSingle();

    if (existingError) {
      console.error("REGISTER CHECK USER ERROR:", existingError);
      return res.status(500).json({
        error: "خطا در بررسی نام کاربری",
        details: existingError.message,
      });
    }

    if (existingUser) {
      return res.status(409).json({
        error: "این نام کاربری قبلا ثبت شده است",
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          username,
          display_name,
          password_hash,
        },
      ])
      .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
      .single();

    if (error) {
      console.error("REGISTER INSERT ERROR:", error);

      if (error.code === "23505") {
        return res.status(409).json({
          error: "این نام کاربری قبلا ثبت شده است",
        });
      }

      return res.status(500).json({
        error: "خطا در ثبت نام",
        details: error.message,
        code: error.code,
      });
    }

    return res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error("REGISTER SERVER ERROR:", err);

    return res.status(500).json({
      error: "خطای سرور هنگام ثبت نام",
      details: err.message,
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .ilike("username", username)
      .single();

    if (error || !user) {
      return res.status(400).json({
        error: "نام کاربری یا رمز اشتباه است",
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(400).json({
        error: "نام کاربری یا رمز اشتباه است",
      });
    }
    if (user.banned) {
      return res.status(403).json({
        error: "حساب شما توسط ادمین مسدود شده است",
      });
    }

const token = jwt.sign(
  {
    id: user.id,
    username: user.username,
    role: user.role,
    premium_plan: user.premium_plan,
    premium_until: user.premium_until,
  },
  process.env.JWT_SECRET,
  {
    expiresIn: "30d",
  },
);
    await supabase
      .from("users")
      .update({
        is_online: true,
        last_seen: new Date(),
      })
      .eq("id", user.id);

    res.json({
      success: true,
      token,
user: {
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  role: user.role,
  premium_plan: user.premium_plan,
  premium_until: user.premium_until,
},
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
const PORT = process.env.PORT || 5000;
app.get("/api/admin/dashboard", auth, admin, async (req, res) => {
  res.json({
    success: true,
    message: "به پنل ادمین Castle X خوش آمدید",
    admin: req.user.username,
  });
});
app.post("/api/posts/create", auth, async (req, res) => {
  try {
    const { content, image_url, video_url } = req.body;

    if (!content && !image_url && !video_url) {
      return res.status(400).json({
        error: "پست خالی است",
      });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert([
        {
          user_id: req.user.id,
          content,
          image_url,
          video_url,
        },
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json(error);
    }

    // پیدا کردن منشن ها
    const mentions =
      content?.match(/@([a-zA-Z0-9_.-]+)/g) || [];

    for (const mention of mentions) {
      const username = mention.replace("@", "");

      const { data: user } = await supabase
        .from("users")
        .select("id")
        .ilike("username", username)
        .single();

      if (
        user &&
        user.id !== req.user.id
      ) {
        await supabase
          .from("notifications")
          .insert([
            {
              user_id: user.id,
              sender_id: req.user.id,
              type: "mention",
              post_id: data.id,
            },
          ]);
      }
    }

    res.json({
      success: true,
      post: data,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.post("/api/posts/:id/save", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", postId)
      .maybeSingle();

    if (postError) {
      return res.status(500).json({
        error: "خطا در بررسی پست",
        details: postError.message,
      });
    }

    if (!post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    const { data: existingSave, error: existingError } = await supabase
      .from("saved_posts")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({
        error: "خطا در بررسی ذخیره پست",
        details: existingError.message,
      });
    }

    if (existingSave) {
      const { error: deleteError } = await supabase
        .from("saved_posts")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", userId);

      if (deleteError) {
        return res.status(500).json({
          error: "خطا در حذف از ذخیره‌ها",
          details: deleteError.message,
        });
      }

      return res.json({
        success: true,
        saved: false,
      });
    }

    const { error: insertError } = await supabase.from("saved_posts").insert({
      post_id: postId,
      user_id: userId,
    });

    if (insertError) {
      return res.status(500).json({
        error: "خطا در ذخیره پست",
        details: insertError.message,
      });
    }

    res.json({
      success: true,
      saved: true,
    });
  } catch (err) {
    console.error("SAVE POST ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/saved-posts", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 30);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: savedRows, error: savedError } = await supabase
      .from("saved_posts")
      .select("post_id, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (savedError) {
      return res.status(500).json({
        error: "خطا در دریافت پست‌های ذخیره‌شده",
        details: savedError.message,
      });
    }

    const result = [];

    for (const saved of savedRows || []) {
      const { data: post } = await supabase
        .from("posts")
        .select("*")
        .eq("id", saved.post_id)
        .maybeSingle();

      if (!post) continue;

      const { data: author } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
        .eq("id", post.user_id)
        .maybeSingle();

      const { count: likesCount } = await supabase
        .from("likes")
        .select("*", { count: "exact", head: true })
        .eq("post_id", post.id);

      const { count: commentsCount } = await supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("post_id", post.id);

      const { data: likeRow } = await supabase
        .from("likes")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", req.user.id)
        .maybeSingle();

      result.push({
        ...post,
        author,
        likes_count: author?.role === "admin" ? (likesCount || 0) + 100 : likesCount || 0,
        comments_count: commentsCount || 0,
        views_count: author?.role === "admin" ? (post.views_count || 0) + 200 : post.views_count || 0,
        is_liked: !!likeRow,
        is_saved: true,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("GET SAVED POSTS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/posts/:id/repost", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const quoteContent =
  typeof req.body?.quote_content === "string"
    ? req.body.quote_content.trim()
    : "";

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, user_id")
      .eq("id", postId)
      .maybeSingle();

    if (postError) {
      return res.status(500).json({
        error: "خطا در بررسی پست",
        details: postError.message,
      });
    }

    if (!post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    const { data: existingRepost, error: existingError } = await supabase
      .from("reposts")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({
        error: "خطا در بررسی ری‌پست",
        details: existingError.message,
      });
    }

    if (existingRepost) {
      const { error: deleteError } = await supabase
        .from("reposts")
        .delete()
        .eq("id", existingRepost.id);

      if (deleteError) {
        return res.status(500).json({
          error: "خطا در حذف ری‌پست",
          details: deleteError.message,
        });
      }

      const { count } = await supabase
        .from("reposts")
        .select("*", { count: "exact", head: true })
        .eq("post_id", postId);

      return res.json({
        success: true,
        reposted: false,
        reposts_count: count || 0,
      });
    }

const { error: insertError } = await supabase.from("reposts").insert({
  post_id: postId,
  user_id: userId,
  quote_content: quoteContent || null,
});

    if (insertError) {
      return res.status(500).json({
        error: "خطا در ثبت ری‌پست",
        details: insertError.message,
      });
    }

    const { count } = await supabase
      .from("reposts")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    res.json({
      success: true,
      reposted: true,
      reposts_count: count || 0,
    });
  } catch (err) {
    console.error("REPOST ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
const getPostStats = async (post, userId) => {
  const [{ count: likesCount }, { count: commentsCount }, { count: repostsCount }] =
    await Promise.all([
      supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
      supabase.from("comments").select("*", { count: "exact", head: true }).eq("post_id", post.id),
      supabase.from("reposts").select("*", { count: "exact", head: true }).eq("post_id", post.id),
    ]);

  const { data: author } = await supabase
    .from("users")
    .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
    .eq("id", post.user_id)
    .single();

  const { data: likeRow } = await supabase
    .from("likes")
    .select("id")
    .eq("post_id", post.id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: repostRow } = await supabase
    .from("reposts")
    .select("id")
    .eq("post_id", post.id)
    .eq("user_id", userId)
    .maybeSingle();
    const { data: savedRow } = await supabase
  .from("saved_posts")
  .select("post_id")
  .eq("post_id", post.id)
  .eq("user_id", userId)
  .maybeSingle();

  return {
    author,
    likes_count: author?.role === "admin" ? (likesCount || 0) + 100 : likesCount || 0,
    comments_count: commentsCount || 0,
    reposts_count: repostsCount || 0,
    views_count: author?.role === "admin" ? (post.views_count || 0) + 200 : post.views_count || 0,
    is_liked: !!likeRow,
    is_reposted: !!repostRow,
    is_saved: !!savedRow,
  };
};
const buildRepostFeedItem = async (repost, currentUserId) => {
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("*")
    .eq("id", repost.post_id)
    .maybeSingle();

  if (postError || !post) {
    return null;
  }

  const { data: repostedBy } = await supabase
    .from("users")
    .select("id, username, display_name, avatar_url, role, is_verified, premium_until, premium_plan")
    .eq("id", repost.user_id)
    .maybeSingle();

  const stats = await getPostStats(post, currentUserId);

return {
  ...post,
  ...stats,
  reposted_by: repostedBy,
  reposted_at: repost.created_at,
  quote_content: repost.quote_content || "",
  feed_time: repost.created_at,
  hot_priority: 0,
};
};
const getRankingStartDate = async () => {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "ranking_last_reset_at")
    .maybeSingle();

  if (data?.value) {
    return new Date(data.value);
  }

  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
};

const resetRankingStartDate = async () => {
  const now = new Date().toISOString();

  await supabase.from("app_settings").upsert({
    key: "ranking_last_reset_at",
    value: now,
    updated_at: now,
  });

  return now;
};
app.get("/api/rankings/weekly", auth, async (req, res) => {
  try {
    const rankingStart = await getRankingStartDate();
    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, user_id, content, image_url, video_url, views_count, created_at")
      .gte("created_at", rankingStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(200);

    if (postsError) {
      return res.status(500).json({
        error: "خطا در دریافت پست‌های هفته",
        details: postsError.message,
      });
    }

    const userScores = {};
    const rankedPosts = [];

    for (const post of posts || []) {
      const [
        { count: likesCount },
        { count: commentsCount },
        { count: repostsCount },
      ] = await Promise.all([
        supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id),

        supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id),

        supabase
          .from("reposts")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id),
      ]);

      const { data: author } = await supabase
        .from("users")
        .select(
          "id, username, display_name, avatar_url, role, is_verified, premium_plan, premium_until"
        )
        .eq("id", post.user_id)
        .maybeSingle();

      if (!author) continue;

      const likes = likesCount || 0;
      const comments = commentsCount || 0;
      const reposts = repostsCount || 0;
      const views = post.views_count || 0;

      const score = views + likes * 4 + comments * 6 + reposts * 8;

      if (!userScores[author.id]) {
        userScores[author.id] = {
          user: author,
          posts_count: 0,
          views: 0,
          likes: 0,
          comments: 0,
          reposts: 0,
          score: 0,
        };
      }

      userScores[author.id].posts_count += 1;
      userScores[author.id].views += views;
      userScores[author.id].likes += likes;
      userScores[author.id].comments += comments;
      userScores[author.id].reposts += reposts;
      userScores[author.id].score += score;

      rankedPosts.push({
        ...post,
        author,
        likes_count: likes,
        comments_count: comments,
        reposts_count: reposts,
        views_count: views,
        score,
      });
    }

    const topCreators = Object.values(userScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const topLikedPosts = [...rankedPosts]
      .sort((a, b) => b.likes_count - a.likes_count)
      .slice(0, 5);

    const topCommentedPosts = [...rankedPosts]
      .sort((a, b) => b.comments_count - a.comments_count)
      .slice(0, 5);

    const topViewedPosts = [...rankedPosts]
      .sort((a, b) => b.views_count - a.views_count)
      .slice(0, 5);

    const topRepostedPosts = [...rankedPosts]
      .sort((a, b) => b.reposts_count - a.reposts_count)
      .slice(0, 5);

    const weekKey = new Date().toISOString().slice(0, 10);
    const winners = topCreators.slice(0, 3);

    await Promise.all(
      winners.map(async (item, index) => {
        const rank = index + 1;

        const message = `تبریک! شما رتبه ${rank} رتبه‌بندی هفتگی Castle X را به دست آوردید. | ${weekKey}`;

        const { data: existingNotification, error: existingError } =
          await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", item.user.id)
            .eq("type", "weekly_top_creator")
            .ilike("message", `%${weekKey}%`)
            .maybeSingle();

        if (existingError) {
          console.error("CHECK RANKING NOTIFICATION ERROR:", existingError);
          return;
        }

        if (existingNotification) return;

        const { error: insertNotificationError } = await supabase
          .from("notifications")
          .insert({
            user_id: item.user.id,
            sender_id: req.user.id,
            type: "weekly_top_creator",
            message,
          });

        if (insertNotificationError) {
          console.error(
            "INSERT RANKING NOTIFICATION ERROR:",
            insertNotificationError
          );
        }
      })
    );

    res.json({
        ranking_started_at: rankingStart.toISOString(),
      topCreators,
      topLikedPosts,
      topCommentedPosts,
      topViewedPosts,
      topRepostedPosts,
    });
  } catch (err) {
    console.error("WEEKLY RANKINGS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/posts", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 30);
const page = Math.max(Number(req.query.page) || 1, 1);
const from = (page - 1) * limit;
const to = from + limit - 1;
    const { data: posts, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json(error);

    const now = new Date();

    const result = await Promise.all(
      posts.map(async (post) => {
        const { count: likesCount } = await supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { count: commentsCount } = await supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { data: author } = await supabase
          .from("users")
          .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
          .eq("id", post.user_id)
          .single();

        const { data: likeRow } = await supabase
          .from("likes")
          .select("id")
          .eq("post_id", post.id)
          .eq("user_id", req.user.id)
          .maybeSingle();
const { count: repostsCount } = await supabase
  .from("reposts")
  .select("*", {
    count: "exact",
    head: true,
  })
  .eq("post_id", post.id);

const { data: repostRow } = await supabase
  .from("reposts")
  .select("id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
  const { data: savedRow } = await supabase
  .from("saved_posts")
  .select("post_id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
        const { data: promotion } = await supabase
          .from("post_promotions")
          .select("*")
          .eq("post_id", post.id)
          .eq("active", true)
          .lte("starts_at", now.toISOString())
          .gt("ends_at", now.toISOString())
          .order("priority", { ascending: false })
          .limit(1)
          .maybeSingle();

        let feedTime = post.created_at;

        if (promotion) {
          const lastBumpedAt = new Date(promotion.last_bumped_at || promotion.created_at);
          const intervalMs = (promotion.bump_interval_minutes || 60) * 60 * 1000;

          if (now.getTime() - lastBumpedAt.getTime() >= intervalMs) {
            const bumpedAt = now.toISOString();

            await supabase
              .from("post_promotions")
              .update({ last_bumped_at: bumpedAt })
              .eq("id", promotion.id);

            feedTime = bumpedAt;
          } else {
            feedTime = promotion.last_bumped_at || promotion.created_at;
          }
        }

        return {
          ...post,
          author,
          likes_count:
            author?.role === "admin"
              ? (likesCount || 0) + 100
              : likesCount || 0,
          comments_count: commentsCount || 0,
          reposts_count: repostsCount || 0,
          views_count:
            author?.role === "admin"
              ? (post.views_count || 0) + 200
              : post.views_count || 0,
          is_liked: !!likeRow,
          is_reposted: !!repostRow,
          is_saved: !!savedRow,
          is_hot: !!promotion,
          hot_priority: promotion?.priority || 0,
          hot_until: promotion?.ends_at || null,
          feed_time: feedTime,
        };
      })
    );
        const { data: repostRows, error: repostError } = await supabase
      .from("reposts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (repostError) {
      return res.status(500).json(repostError);
    }

    const repostItems = (
      await Promise.all(
        (repostRows || []).map((repost) =>
          buildRepostFeedItem(repost, req.user.id)
        )
      )
    ).filter(Boolean);

    result.push(...repostItems);
    result.sort((a, b) => {
      const hotDiff = (b.hot_priority || 0) - (a.hot_priority || 0);
      if (hotDiff !== 0) return hotDiff;

      return new Date(b.feed_time).getTime() - new Date(a.feed_time).getTime();
    });

   res.json(result.slice(0, limit));
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.get("/api/posts/following", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 30);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: follows, error: followsError } = await supabase
      .from("followers")
      .select("following_id")
      .eq("follower_id", req.user.id);

    if (followsError) {
      return res.status(500).json(followsError);
    }

    const followingIds = (follows || [])
      .map((item) => item.following_id)
      .filter(Boolean);

    if (followingIds.length === 0) {
      return res.json([]);
    }

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("*")
      .in("user_id", followingIds)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (postsError) {
      return res.status(500).json(postsError);
    }

    const result = await Promise.all(
      (posts || []).map(async (post) => {
        const { data: author } = await supabase
          .from("users")
          .select(
            "id, username, display_name, avatar_url, role, is_verified, premium_until, premium_plan"
          )
          .eq("id", post.user_id)
          .single();

        const { count: likesCount } = await supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { count: commentsCount } = await supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { data: likeRow } = await supabase
          .from("likes")
          .select("id")
          .eq("post_id", post.id)
          .eq("user_id", req.user.id)
          .maybeSingle();
const { count: repostsCount } = await supabase
  .from("reposts")
  .select("*", {
    count: "exact",
    head: true,
  })
  .eq("post_id", post.id);

const { data: repostRow } = await supabase
  .from("reposts")
  .select("id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
        return {
          ...post,
          author,
          likes_count:
            author?.role === "admin"
              ? (likesCount || 0) + 100
              : likesCount || 0,
          comments_count: commentsCount || 0,
          reposts_count: repostsCount || 0,
          views_count:
            author?.role === "admin"
              ? (post.views_count || 0) + 200
              : post.views_count || 0,
          is_liked: !!likeRow,
          is_reposted: !!repostRow,
        };
      })
    );
    const { data: repostRows, error: repostError } = await supabase
      .from("reposts")
      .select("*")
      .in("user_id", followingIds)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (repostError) {
      return res.status(500).json(repostError);
    }

    const repostItems = (
      await Promise.all(
        (repostRows || []).map((repost) =>
          buildRepostFeedItem(repost, req.user.id)
        )
      )
    ).filter(Boolean);

    result.push(...repostItems);

    result.sort(
      (a, b) =>
        new Date(b.feed_time || b.reposted_at || b.created_at).getTime() -
        new Date(a.feed_time || a.reposted_at || a.created_at).getTime()
    );
    res.json(result.slice(0, limit));
  } catch (err) {
    console.error("FOLLOWING POSTS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/posts/:id/view", async (req, res) => {
  try {
    const { id } = req.params;
    const { visitor_key } = req.body || {};

    let viewerKey = null;

    const authHeader = req.headers.authorization || "";

    if (authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded?.id) {
          viewerKey = `user:${decoded.id}`;
        }
      } catch (err) {
        viewerKey = null;
      }
    }

    if (!viewerKey) {
      const safeVisitorKey =
        visitor_key ||
        `${req.ip || "unknown"}-${req.headers["user-agent"] || "unknown"}`;

      viewerKey = `visitor:${safeVisitorKey}`;
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, views_count")
      .eq("id", id)
      .maybeSingle();

    if (postError) {
      return res.status(500).json({
        error: "خطا در بررسی پست",
        details: postError.message,
      });
    }

    if (!post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const { data: existingView, error: existingError } = await supabase
      .from("post_views")
      .select("id")
      .eq("post_id", id)
      .eq("viewer_key", viewerKey)
      .gte("created_at", sixHoursAgo)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({
        error: "خطا در بررسی بازدید",
        details: existingError.message,
      });
    }

    if (existingView) {
      return res.json({
        success: true,
        counted: false,
        views_count: post.views_count || 0,
      });
    }

    const { error: insertError } = await supabase.from("post_views").insert({
      post_id: id,
      viewer_key: viewerKey,
    });

    if (insertError) {
      return res.status(500).json({
        error: "خطا در ثبت بازدید",
        details: insertError.message,
      });
    }

    const { data: newViewsCount, error: incrementError } = await supabase.rpc(
      "increment_post_views",
      {
        post_id_input: Number(id),
      }
    );

    if (incrementError) {
      return res.status(500).json({
        error: "خطا در افزایش بازدید",
        details: incrementError.message,
      });
    }

    res.json({
      success: true,
      counted: true,
      views_count: newViewsCount || 0,
    });
  } catch (err) {
    console.error("POST VIEW ERROR:", err);

    res.status(500).json({
      error: "خطای سرور در ثبت ویو",
      details: err.message,
    });
  }
});

app.post("/api/posts/:id/like", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    const { data: existingLikes } = await supabase
      .from("likes")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", req.user.id);

    // حذف لایک
    if (existingLikes && existingLikes.length > 0) {
      await supabase
        .from("likes")
        .delete()
        .eq("id", existingLikes[0].id);

      return res.json({
        success: true,
        liked: false,
      });
    }

    // ساخت لایک
    await supabase.from("likes").insert({
      post_id: postId,
      user_id: req.user.id,
    });

    // گرفتن صاحب پست
    const { data: post } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", postId)
      .single();

    // ساخت نوتیف لایک
    if (post && post.user_id !== req.user.id) {
      await supabase
        .from("notifications")
        .insert({
          user_id: post.user_id,
          sender_id: req.user.id,
          type: "like",
          post_id: postId,
        });
    }

    return res.json({
      success: true,
      liked: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});

app.post("/api/comments/create", auth, async (req, res) => {
  try {
    const { post_id, content } = req.body;

    if (!post_id || !content?.trim()) {
      return res.status(400).json({
        error: "متن کامنت خالی است",
      });
    }

    const cleanContent = content.trim();

    const { data, error } = await supabase
      .from("comments")
      .insert([
        {
          post_id,
          user_id: req.user.id,
          content: cleanContent,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    const { data: post } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", post_id)
      .single();

    if (post && String(post.user_id) !== String(req.user.id)) {
      await supabase.from("notifications").insert({
        user_id: post.user_id,
        sender_id: req.user.id,
        type: "comment",
        post_id,
        title: "کامنت جدید",
        message: "برای پست شما کامنت گذاشت",
      });
    }

    const mentionedUsernames = [
      ...new Set(
        cleanContent
          .match(/@[a-zA-Z0-9_.-]+/g)
          ?.map((item) => item.slice(1).trim())
          .filter(Boolean) || []
      ),
    ];

    if (mentionedUsernames.length > 0) {
      const { data: mentionedUsers } = await supabase
        .from("users")
        .select("id, username")
        .in("username", mentionedUsernames);

      const mentionNotifications = (mentionedUsers || [])
        .filter((user) => String(user.id) !== String(req.user.id))
        .map((user) => ({
          user_id: user.id,
          sender_id: req.user.id,
          type: "mention",
          post_id,
          title: "منشن جدید",
          message: "شما را در یک کامنت منشن کرد",
        }));

      if (mentionNotifications.length > 0) {
        await supabase.from("notifications").insert(mentionNotifications);
      }
    }

    res.json({
      success: true,
      comment: data[0],
    });
  } catch (err) {
    console.error("CREATE COMMENT ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/comments/:postId", async (req, res) => {
  const { data: comments, error } = await supabase
    .from("comments")
    .select("*")
    .eq("post_id", req.params.postId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    return res.status(500).json(error);
  }

  const commentsWithUsers = await Promise.all(
    comments.map(async (comment) => {
      const { data: user } = await supabase
        .from("users")
        .select(
          "username, display_name, avatar_url, role, is_verified, premium_until, premium_plan"
        )
        .eq("id", comment.user_id)
        .single();

      return {
        ...comment,
        author: user,
      };
    })
  );

  res.json(commentsWithUsers);
});
// فالو کردن کاربر
app.post("/api/users/:id/follow", auth, async (req, res) => {
  try {
    const followingId = req.params.id;

    if (Number(followingId) === req.user.id) {
      return res.status(400).json({
        error: "نمی‌توانید خودتان را فالو کنید",
      });
    }

    const { data: existing } = await supabase
      .from("followers")
      .select("*")
      .eq("follower_id", req.user.id)
      .eq("following_id", followingId)
      .single();

    if (existing) {
      return res.status(400).json({
        error: "قبلاً فالو کرده‌اید",
      });
    }

    await supabase.from("followers").insert([
      {
        follower_id: req.user.id,
        following_id: followingId,
      },
    ]);
    await supabase.from("notifications").insert({
      user_id: followingId,
      sender_id: req.user.id,
      type: "follow",
    });

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.get("/api/users/:username/followers", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);

    const { data: usersFound, error: userError } = await supabase
      .from("users")
      .select("id, role")
      .ilike("username", username)
      .limit(1);

    if (userError) {
      console.error("followers userError:", userError);
      return res.status(500).json(userError);
    }

    const profileUser = usersFound?.[0];

    if (!profileUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (profileUser.role === "admin" || profileUser.role === "founder") {
      return res.status(403).json({
        error: "Admin follow list is private",
      });
    }

    const { data: follows, error: followsError } = await supabase
      .from("followers")
      .select("follower_id")
      .eq("following_id", profileUser.id);

    if (followsError) {
      console.error("followers followsError:", followsError);
      return res.status(500).json(followsError);
    }

    const ids = [
      ...new Set(
        (follows || [])
          .map((item) => item.follower_id)
          .filter(Boolean)
      ),
    ];

    if (ids.length === 0) {
      return res.json([]);
    }

    const result = [];

    for (const id of ids) {
      const { data: foundUser, error: foundUserError } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
        .eq("id", id)
        .maybeSingle();

      if (foundUserError) {
        console.error("followers foundUserError:", foundUserError);
      }

      if (foundUser) {
        result.push(foundUser);
      }
    }

    return res.json(result);
  } catch (err) {
    console.error("followers error:", err);

    return res.status(500).json({
      error: String(err.message || err),
    });
  }
});

app.get("/api/users/:username/following", async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username);

    const { data: usersFound, error: userError } = await supabase
      .from("users")
      .select("id, role")
      .ilike("username", username)
      .limit(1);

    if (userError) {
      console.error("following userError:", userError);
      return res.status(500).json(userError);
    }

    const profileUser = usersFound?.[0];

    if (!profileUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (profileUser.role === "admin" || profileUser.role === "founder") {
      return res.status(403).json({
        error: "Admin follow list is private",
      });
    }

    const { data: follows, error: followsError } = await supabase
      .from("followers")
      .select("following_id")
      .eq("follower_id", profileUser.id);

    if (followsError) {
      console.error("following followsError:", followsError);
      return res.status(500).json(followsError);
    }

    const ids = [
      ...new Set(
        (follows || [])
          .map((item) => item.following_id)
          .filter(Boolean)
      ),
    ];

    if (ids.length === 0) {
      return res.json([]);
    }

    const result = [];

    for (const id of ids) {
      const { data: foundUser, error: foundUserError } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url, is_verified, role, premium_until, premium_plan")
        .eq("id", id)
        .maybeSingle();

      if (foundUserError) {
        console.error("following foundUserError:", foundUserError);
      }

      if (foundUser) {
        result.push(foundUser);
      }
    }

    return res.json(result);
  } catch (err) {
    console.error("following error:", err);

    return res.status(500).json({
      error: String(err.message || err),
    });
  }
});
app.get("/api/users/:username/posts", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 30);
const page = Math.max(Number(req.query.page) || 1, 1);
const from = (page - 1) * limit;
const to = from + limit - 1;
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .ilike("username", req.params.username)
      .single();

    if (!user) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

const { data: posts, error: postsError } = await supabase
  .from("posts")
  .select("*")
  .eq("user_id", user.id)
  .order("created_at", {
    ascending: false,
  })
  .range(from, to);

if (postsError) {
  return res.status(500).json({
    error: "خطا در دریافت پست‌های پروفایل",
    details: postsError.message,
  });
}



    const result = [];

    for (const post of posts || []) {
      const { data: author } = await supabase
        .from("users")
        .select(
          `
          id,
          username,
          display_name,
          avatar_url,
          is_verified,
          role,
          premium_until,
          premium_plan
        `,
        )
        .eq("id", post.user_id)
        .single();

      const { count: likesCount } = await supabase
        .from("likes")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("post_id", post.id);

      const { count: commentsCount } = await supabase
        .from("comments")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("post_id", post.id);

      const { data: likeRow } = await supabase
        .from("likes")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", req.user.id)
        .maybeSingle();
const { count: repostsCount } = await supabase
  .from("reposts")
  .select("*", {
    count: "exact",
    head: true,
  })
  .eq("post_id", post.id);

const { data: repostRow } = await supabase
  .from("reposts")
  .select("id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
  const { data: savedRow } = await supabase
  .from("saved_posts")
  .select("post_id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
      result.push({
        ...post,
        author,

        likes_count:
          author?.role === "admin" ? (likesCount || 0) + 100 : likesCount || 0,

        comments_count: commentsCount || 0,
        reposts_count: repostsCount || 0,
        views_count:
          author?.role === "admin"
            ? (post.views_count || 0) + 200
            : post.views_count || 0,

        is_liked: !!likeRow,
        is_reposted: !!repostRow,
        is_saved: !!savedRow,
      });
    }
const { data: repostRows, error: repostError } = await supabase
  .from("reposts")
  .select("*")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .range(from, to);

    if (repostError) {
      return res.status(500).json(repostError);
    }

    const repostItems = (
      await Promise.all(
        (repostRows || []).map((repost) =>
          buildRepostFeedItem(repost, req.user.id)
        )
      )
    ).filter(Boolean);

    result.push(...repostItems);

    result.sort(
      (a, b) =>
        new Date(b.feed_time || b.reposted_at || b.created_at).getTime() -
        new Date(a.feed_time || a.reposted_at || a.created_at).getTime()
    );
    const limitedResult = result.slice(0, limit);
res.json(limitedResult);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.get("/api/users/:id/is-following", auth, async (req, res) => {
  try {
    const { data } = await supabase
      .from("followers")
      .select("*")
      .eq("follower_id", req.user.id)
      .eq("following_id", req.params.id)
      .single();

    res.json({
      following: !!data,
    });
  } catch {
    res.json({
      following: false,
    });
  }
});
// آنفالو
app.delete("/api/users/:id/follow", auth, async (req, res) => {
  try {
    await supabase
      .from("followers")
      .delete()
      .eq("follower_id", req.user.id)
      .eq("following_id", req.params.id);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
// دریافت پروفایل
app.get("/api/users/:username", async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .ilike("username", req.params.username)
      .single();

    if (!user) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

    const { count: followersCount } = await supabase
      .from("followers")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("following_id", user.id);

    const { count: followingCount } = await supabase
      .from("followers")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("follower_id", user.id);
res.json({
  ...user,
  followers_count:
  user.role === "admin"
    ? (followersCount || 0) + 300
    : followersCount || 0,

  following_count: followingCount || 0,
});
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.get("/api/users/:username/ranking-awards", async (req, res) => {
  try {
    const { username } = req.params;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, username, display_name")
      .ilike("username", username)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({
        error: "خطا در دریافت کاربر",
        details: userError.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

    const { data: awards, error: awardsError } = await supabase
      .from("ranking_awards")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (awardsError) {
      return res.status(500).json({
        error: "خطا در دریافت افتخارات",
        details: awardsError.message,
      });
    }

    const gold = (awards || []).filter((item) => item.rank === 1).length;
    const silver = (awards || []).filter((item) => item.rank === 2).length;
    const bronze = (awards || []).filter((item) => item.rank === 3).length;

    res.json({
      user,
      total: awards?.length || 0,
      gold,
      silver,
      bronze,
      awards: awards || [],
    });
  } catch (err) {
    console.error("GET RANKING AWARDS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.put("/api/users/me", auth, async (req, res) => {
  try {
    const { display_name, bio, avatar_url } = req.body;

    const { data, error } = await supabase
      .from("users")
      .update({
        display_name,
        bio,
        avatar_url,
      })
      .eq("id", req.user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.get("/api/search/users", async (req, res) => {
  try {
    const q = req.query.q || "";

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .ilike("username", `%${q}%`)
      .limit(20);

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.post("/api/messages/start", auth, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "userId required",
      });
    }

    const { data: myConversations } = await supabase
      .from("conversation_members")
      .select("*")
      .eq("user_id", req.user.id);

    for (const item of myConversations || []) {
      const { data: members } = await supabase
        .from("conversation_members")
        .select("*")
        .eq("conversation_id", item.conversation_id);

      const exists = members?.find((m) => m.user_id === userId);

      if (exists) {
        return res.json({
          conversation_id: item.conversation_id,
        });
      }
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .insert({})
      .select()
      .single();

    await supabase.from("conversation_members").insert([
      {
        conversation_id: conversation.id,
        user_id: req.user.id,
      },
      {
        conversation_id: conversation.id,
        user_id: userId,
      },
    ]);

    res.json({
      conversation_id: conversation.id,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.post("/api/messages/send", auth, async (req, res) => {
  try {
    const { conversation_id, content, reply_to_id } = req.body;

    const text = content?.trim() || "";

    if (!conversation_id || !text) {
      return res.status(400).json({
        error: "conversation_id و content الزامی هستند",
      });
    }

    let replyToContent = null;

    if (reply_to_id) {
      const { data: replyMessage, error: replyError } = await supabase
        .from("messages")
        .select("content")
        .eq("id", reply_to_id)
        .eq("conversation_id", conversation_id)
        .maybeSingle();

      if (replyError) {
        return res.status(500).json({
          error: "خطا در بررسی پیام ریپلای شده",
          details: replyError.message,
        });
      }

      if (replyMessage) {
        replyToContent = replyMessage.content;
      }
    }

    const insertData = {
      conversation_id,
      sender_id: req.user.id,
      content: text,
      reply_to_id: reply_to_id || null,
      reply_to_content: replyToContent,
    };

    const { data, error } = await supabase
      .from("messages")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.get("/api/messages/unread-count", auth, async (req, res) => {
  try {
    const { data: memberships, error: membershipError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", req.user.id);

    if (membershipError) {
      return res.status(500).json({
        error: "خطا در دریافت گفتگوها",
        details: membershipError.message,
      });
    }

    const conversationIds = (memberships || []).map((item) => item.conversation_id);

    if (conversationIds.length === 0) {
      return res.json({ count: 0 });
    }

    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", conversationIds)
      .neq("sender_id", req.user.id)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({
        error: "خطا در دریافت پیام‌های جدید",
        details: error.message,
      });
    }

    res.json({ count: count || 0 });
  } catch (err) {
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.put("/api/messages/conversations/:conversationId/read", auth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const { error } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .neq("sender_id", req.user.id)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({
        error: "خطا در خوانده کردن پیام‌ها",
        details: error.message,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/messages/:conversationId", auth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", {
        ascending: true,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/messages/:conversationId/seen", auth, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const { error } = await supabase
      .from("messages")
      .update({
        seen_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId)
      .neq("sender_id", req.user.id)
      .is("seen_at", null);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});

app.get("/api/conversations", auth, async (req, res) => {
  try {
    const { data: memberships, error: membershipError } = await supabase
      .from("conversation_members")
      .select("*")
      .eq("user_id", req.user.id);

    if (membershipError) {
      return res.status(500).json({
        error: "خطا در دریافت گفتگوها",
        details: membershipError.message,
      });
    }

    const result = [];

    for (const m of memberships || []) {
      const { data: members } = await supabase
        .from("conversation_members")
        .select("*")
        .eq("conversation_id", m.conversation_id);

      const other = members?.find((x) => String(x.user_id) !== String(req.user.id));

      if (!other) continue;

      const { data: user } = await supabase
        .from("users")
        .select(
          "id, username, display_name, avatar_url, is_online, last_seen, is_verified, role, premium_until, premium_plan"
        )
        .eq("id", other.user_id)
        .single();

      const { data: lastMessage } = await supabase
        .from("messages")
        .select("content, created_at")
        .eq("conversation_id", m.conversation_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", m.conversation_id)
        .neq("sender_id", req.user.id)
        .eq("is_read", false);

      result.push({
        conversation_id: m.conversation_id,
        user,
        last_message: lastMessage?.content || "",
        last_message_time: lastMessage?.created_at || null,
        unread_count: unreadCount || 0,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("CONVERSATIONS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/notifications/unread-count", auth, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({
        error: "خطا در دریافت تعداد نوتیفیکیشن‌ها",
        details: error.message,
      });
    }

    res.json({ count: count || 0 });
  } catch (err) {
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/notifications", auth, async (req, res) => {
  try {
    const { data: notifications, error } = await supabase
      .from("notifications")
      .select(
        `
        *,
        sender:users!notifications_sender_id_fkey(
          id,
          username,
          display_name,
          avatar_url,
          role,
          is_verified,
          premium_plan,
          premium_until
        )
      `,
      )
      .eq("user_id", req.user.id)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    const result = await Promise.all(
      (notifications || []).map(async (notification) => {
        let postAuthor = null;

        if (notification.post_id) {
          const { data: post } = await supabase
            .from("posts")
            .select("id, user_id")
            .eq("id", notification.post_id)
            .maybeSingle();

          if (post?.user_id) {
            const { data: author } = await supabase
              .from("users")
              .select(
                "id, username, display_name, avatar_url, role, is_verified, premium_plan, premium_until",
              )
              .eq("id", post.user_id)
              .maybeSingle();

            postAuthor = author;
          }
        }

        return {
          ...notification,
          post_author: postAuthor,
        };
      }),
    );

    res.json(result);
  } catch (err) {
    console.error("NOTIFICATIONS ERROR:", err);

    res.status(500).json({
      error: "Server Error",
      details: err.message,
    });
  }
});

app.put("/api/notifications/read-all", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("notifications")
      .update({
        is_read: true,
      })
      .eq("user_id", req.user.id)
      .eq("is_read", false);

    if (error) {
      return res.status(500).json({
        error: "خطا در خوانده کردن نوتیفیکیشن‌ها",
        details: error.message,
      });
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error("READ ALL NOTIFICATIONS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.put("/api/users/online", auth, async (req, res) => {
  await supabase
    .from("users")
    .update({
      is_online: true,
    })
    .eq("id", req.user.id);

  res.json({
    success: true,
  });
});
app.put("/api/users/offline", auth, async (req, res) => {
  await supabase
    .from("users")
    .update({
      is_online: false,
      last_seen: new Date(),
    })
    .eq("id", req.user.id);

  res.json({
    success: true,
  });
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    const { data: post } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (!post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    if (post.user_id !== req.user.id) {
      return res.status(403).json({
        error: "اجازه حذف ندارید",
      });
    }

    await supabase.from("likes").delete().eq("post_id", postId);

    await supabase.from("comments").delete().eq("post_id", postId);

    await supabase.from("notifications").delete().eq("post_id", postId);

    await supabase.from("posts").delete().eq("id", postId);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "خطای سرور",
    });
  }
});
app.put("/api/users/me/theme", auth, async (req, res) => {
  try {
    const { profile_theme } = req.body;

    const allowedThemes = ["default", "silver", "ice", "royal", "gold"];

    if (!allowedThemes.includes(profile_theme)) {
      return res.status(400).json({
        error: "تم انتخاب شده معتبر نیست",
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, role, premium_plan, premium_until")
      .eq("id", req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

    const premiumActive =
      user.premium_plan === "silver" &&
      user.premium_until &&
      new Date(user.premium_until).getTime() > Date.now();

    const canUseProfileTheme = premiumActive || user.role === "admin";

    if (profile_theme !== "default" && !canUseProfileTheme) {
      return res.status(403).json({
        error: "تغییر تم پروفایل فقط برای کاربران پریمیوم و ادمین‌ها فعال است",
      });
    }

    const { data, error } = await supabase
      .from("users")
      .update({ profile_theme })
      .eq("id", req.user.id)
      .select(
        "id, username, display_name, avatar_url, bio, role, is_verified, premium_plan, premium_until, profile_theme"
      )
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در ذخیره تم پروفایل",
        details: error.message,
      });
    }

    res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error("UPDATE PROFILE THEME ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/admin/users", auth, admin, async (req, res) => {
  const { data, error } = await supabase.from("users").select("*").order("id");

  if (error) {
    return res.status(500).json(error);
  }

  res.json(data);
});
app.get("/api/admin/users", auth, admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("id", {
        ascending: true,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/admin/verify/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        is_verified: true,
      })
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/admin/unverify/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        is_verified: false,
      })
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
// دادن ادمین

app.put("/api/admin/make-admin/:id", auth, admin, async (req, res) => {
  try {
    await supabase
      .from("users")
      .update({
        role: "admin",
      })
      .eq("id", req.params.id);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});

// حذف ادمین

app.put("/api/admin/remove-admin/:id", auth, admin, async (req, res) => {
  try {
    await supabase
      .from("users")
      .update({
        role: "user",
      })
      .eq("id", req.params.id);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/admin/users/:id/account", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;
    let { username, display_name, password, admin_edit_secret } = req.body;

    if (admin_edit_secret !== process.env.ADMIN_EDIT_SECRET) {
      return res.status(403).json({
        error: "رمز ویرایش ادمین اشتباه است",
      });
    }

    username = username?.trim();
    display_name = display_name?.trim();

    if (!username || !display_name) {
      return res.status(400).json({
        error: "نام کاربری و نام نمایشی الزامی هستند",
      });
    }

    if (password && password.length < 6) {
      return res.status(400).json({
        error: "رمز جدید باید حداقل ۶ کاراکتر باشد",
      });
    }

    const { data: targetUser, error: targetError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", id)
      .maybeSingle();

    if (targetError) {
      return res.status(500).json({
        error: "خطا در بررسی کاربر",
        details: targetError.message,
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

    const { data: sameUsername, error: sameUsernameError } = await supabase
      .from("users")
      .select("id")
      .ilike("username", username)
      .neq("id", id)
      .maybeSingle();

    if (sameUsernameError) {
      return res.status(500).json({
        error: "خطا در بررسی نام کاربری",
        details: sameUsernameError.message,
      });
    }

    if (sameUsername) {
      return res.status(409).json({
        error: "این نام کاربری قبلا استفاده شده است",
      });
    }

    const updateData = {
      username,
      display_name,
    };

    if (password && password.trim()) {
      updateData.password_hash = await bcrypt.hash(password.trim(), 10);
    }

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("id, username, display_name, avatar_url, is_verified, role, banned, premium_until, premium_plan")
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در تغییر اطلاعات کاربر",
        details: error.message,
      });
    }

    res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error("ADMIN UPDATE USER ACCOUNT ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
// حذف کاربر

app.post("/api/admin/users/:id/delete-secure", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_edit_secret } = req.body || {};

    if (!process.env.ADMIN_EDIT_SECRET) {
      return res.status(500).json({
        error: "ADMIN_EDIT_SECRET روی سرور تنظیم نشده است",
      });
    }

    if (!admin_edit_secret || admin_edit_secret.trim() !== process.env.ADMIN_EDIT_SECRET) {
      return res.status(403).json({
        error: "رمز محرمانه ادمین اشتباه است",
      });
    }

    await supabase
      .from("followers")
      .delete()
      .or(`follower_id.eq.${id},following_id.eq.${id}`);

    await supabase.from("likes").delete().eq("user_id", id);
    await supabase.from("comments").delete().eq("user_id", id);
    await supabase.from("posts").delete().eq("user_id", id);
    await supabase.from("users").delete().eq("id", id);

    res.json({ success: true });
  } catch (err) {
    console.error("ADMIN SECURE DELETE USER ERROR:", err);

    res.status(500).json({
      error: "خطا در حذف کاربر",
      details: err.message,
    });
  }
});
app.post("/api/admin/posts/:id/hot", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;

    let {
      duration_hours,
      priority,
      bump_interval_minutes,
    } = req.body || {};

    duration_hours = Number(duration_hours) || 24;
    priority = Number(priority) || 1;
    bump_interval_minutes = Number(bump_interval_minutes) || 60;

    if (duration_hours < 1) duration_hours = 1;
    if (duration_hours > 720) duration_hours = 720;

    if (priority < 1) priority = 1;
    if (priority > 10) priority = 10;

    if (bump_interval_minutes < 10) bump_interval_minutes = 10;
    if (bump_interval_minutes > 1440) bump_interval_minutes = 1440;

    const endsAt = new Date(
      Date.now() + duration_hours * 60 * 60 * 1000
    ).toISOString();

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (postError) {
      return res.status(500).json({
        error: "خطا در بررسی پست",
        details: postError.message,
      });
    }

    if (!post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    await supabase
      .from("post_promotions")
      .update({ active: false })
      .eq("post_id", id)
      .eq("active", true);

    const { data, error } = await supabase
      .from("post_promotions")
      .insert({
        post_id: id,
        active: true,
        priority,
        ends_at: endsAt,
        bump_interval_minutes,
        last_bumped_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در داغ کردن پست",
        details: error.message,
      });
    }

    res.json({
      success: true,
      promotion: data,
    });
  } catch (err) {
    console.error("MAKE HOT POST ERROR:", err);

    res.status(500).json({
      error: "خطای سرور در داغ کردن پست",
      details: err.message,
    });
  }
});

app.post("/api/admin/posts/:id/stop-hot", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("post_promotions")
      .update({ active: false })
      .eq("post_id", id)
      .eq("active", true);

    if (error) {
      return res.status(500).json({
        error: "خطا در خاموش کردن پست داغ",
        details: error.message,
      });
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error("STOP HOT POST ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/posts/:id/hot-request", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, premium_plan, premium_until")
      .eq("id", req.user.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: "کاربر پیدا نشد" });
    }

    const premiumActive =
      user.premium_plan === "silver" &&
      user.premium_until &&
      new Date(user.premium_until).getTime() > Date.now();

    if (!premiumActive) {
      return res.status(403).json({
        error: "فقط کاربران Premium می‌توانند درخواست پست داغ بدهند",
      });
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (postError || !post) {
      return res.status(404).json({
        error: "این پست برای شما نیست یا پیدا نشد",
      });
    }

    const { count } = await supabase
      .from("hot_post_requests")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .in("status", ["pending", "approved"]);

    if ((count || 0) >= 3) {
      return res.status(403).json({
        error: "شما فقط می‌توانید برای ۳ پست درخواست داغ شدن بدهید",
      });
    }

    const { data, error } = await supabase
      .from("hot_post_requests")
      .insert({
        user_id: req.user.id,
        post_id: id,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در ثبت درخواست",
        details: error.message,
      });
    }

    res.json({ success: true, request: data });
  } catch (err) {
    console.error("HOT REQUEST ERROR:", err);
    res.status(500).json({ error: "خطای سرور", details: err.message });
  }
});
app.get("/api/admin/hot-requests", auth, admin, async (req, res) => {
  try {
    const { data: requests, error } = await supabase
      .from("hot_post_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: "خطا در دریافت درخواست‌ها",
        details: error.message,
      });
    }

    const result = await Promise.all(
      (requests || []).map(async (request) => {
        const { data: user } = await supabase
          .from("users")
          .select(
            "id, username, display_name, avatar_url, role, is_verified, premium_until, premium_plan"
          )
          .eq("id", request.user_id)
          .maybeSingle();

        const { data: post } = await supabase
          .from("posts")
          .select("id, content, media_url, media_type, user_id, created_at")
          .eq("id", request.post_id)
          .maybeSingle();

        return {
          ...request,
          user,
          post,
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error("GET HOT REQUESTS ERROR:", err);
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.post("/api/admin/hot-requests/:id/approve", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;

    let { duration_hours, priority, bump_interval_minutes, admin_note } =
      req.body || {};

    duration_hours = Number(duration_hours) || 24;
    priority = Number(priority) || 1;
    bump_interval_minutes = Number(bump_interval_minutes) || 60;

    if (duration_hours < 1) duration_hours = 1;
    if (duration_hours > 720) duration_hours = 720;

    if (priority < 1) priority = 1;
    if (priority > 10) priority = 10;

    if (bump_interval_minutes < 10) bump_interval_minutes = 10;
    if (bump_interval_minutes > 1440) bump_interval_minutes = 1440;

    const { data: request, error: requestError } = await supabase
      .from("hot_post_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (requestError) {
      return res.status(500).json({
        error: "خطا در بررسی درخواست",
        details: requestError.message,
      });
    }

    if (!request) {
      return res.status(404).json({
        error: "درخواست پیدا نشد",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "این درخواست قبلاً بررسی شده است",
      });
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", request.post_id)
      .maybeSingle();

    if (postError || !post) {
      return res.status(404).json({
        error: "پست پیدا نشد",
      });
    }

    const endsAt = new Date(
      Date.now() + duration_hours * 60 * 60 * 1000
    ).toISOString();

    await supabase
      .from("post_promotions")
      .update({ active: false })
      .eq("post_id", request.post_id)
      .eq("active", true);

    const { data: promotion, error: promotionError } = await supabase
      .from("post_promotions")
      .insert({
        post_id: request.post_id,
        active: true,
        priority,
        ends_at: endsAt,
        bump_interval_minutes,
        last_bumped_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (promotionError) {
      return res.status(500).json({
        error: "خطا در داغ کردن پست",
        details: promotionError.message,
      });
    }

    const { data: updatedRequest, error: updateError } = await supabase
      .from("hot_post_requests")
      .update({
        status: "approved",
        admin_note: admin_note || null,
        decided_at: new Date().toISOString(),
        decided_by: req.user.id,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "پست داغ شد ولی وضعیت درخواست آپدیت نشد",
        details: updateError.message,
      });
    }

    res.json({
      success: true,
      request: updatedRequest,
      promotion,
    });
  } catch (err) {
    console.error("APPROVE HOT REQUEST ERROR:", err);
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.post("/api/admin/hot-requests/:id/reject", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_note } = req.body || {};

    const { data: request, error: requestError } = await supabase
      .from("hot_post_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (requestError) {
      return res.status(500).json({
        error: "خطا در بررسی درخواست",
        details: requestError.message,
      });
    }

    if (!request) {
      return res.status(404).json({
        error: "درخواست پیدا نشد",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "این درخواست قبلاً بررسی شده است",
      });
    }

    const { data, error } = await supabase
      .from("hot_post_requests")
      .update({
        status: "rejected",
        admin_note: admin_note || null,
        decided_at: new Date().toISOString(),
        decided_by: req.user.id,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در رد کردن درخواست",
        details: error.message,
      });
    }

    res.json({
      success: true,
      request: data,
    });
  } catch (err) {
    console.error("REJECT HOT REQUEST ERROR:", err);
    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.put("/api/admin/users/:id/premium", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { months } = req.body;

    const premiumMonths = Math.max(Number(months) || 1, 1);

    const premiumUntil = new Date();
    premiumUntil.setMonth(premiumUntil.getMonth() + premiumMonths);

    const { data, error } = await supabase
      .from("users")
      .update({
        premium_plan: "silver",
        premium_until: premiumUntil.toISOString(),
      })
      .eq("id", id)
      .select(
        "id, username, display_name, avatar_url, role, is_verified, banned, premium_until, premium_plan"
      )
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در فعال کردن پریمیوم",
        details: error.message,
      });
    }

    res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error("SET PREMIUM ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.delete("/api/admin/users/:id/premium", auth, admin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("users")
      .update({
        premium_plan: null,
        premium_until: null,
      })
      .eq("id", id)
      .select(
        "id, username, display_name, avatar_url, role, is_verified, banned, premium_until, premium_plan"
      )
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در غیرفعال کردن پریمیوم",
        details: error.message,
      });
    }

    res.json({
      success: true,
      user: data,
    });
  } catch (err) {
    console.error("REMOVE PREMIUM ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/premium/profile-analytics/:username", auth, async (req, res) => {
  try {
    const { username } = req.params;

    const { data: profileUser, error: userError } = await supabase
      .from("users")
      .select("id, username, display_name, role, premium_plan, premium_until")
      .ilike("username", username)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({
        error: "خطا در دریافت کاربر",
        details: userError.message,
      });
    }

    if (!profileUser) {
      return res.status(404).json({
        error: "کاربر پیدا نشد",
      });
    }

    const isOwner = Number(req.user.id) === Number(profileUser.id);
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: "فقط صاحب پروفایل یا ادمین می‌تواند آمار پیشرفته را ببیند",
      });
    }

const premiumActive =
  profileUser.premium_plan === "silver" &&
  profileUser.premium_until &&
  new Date(profileUser.premium_until).getTime() > Date.now();

const isProfileAdmin = profileUser.role === "admin";

if (!premiumActive && !isProfileAdmin && !isAdmin) {
  return res.status(403).json({
    error: "این قابلیت فقط برای کاربران پریمیوم، پروفایل‌های ادمین و ادمین‌ها فعال است",
  });
}

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, content, created_at, views_count")
      .eq("user_id", profileUser.id)
      .order("created_at", { ascending: false });

    if (postsError) {
      return res.status(500).json({
        error: "خطا در دریافت پست‌ها",
        details: postsError.message,
      });
    }

    const analyzedPosts = await Promise.all(
      (posts || []).map(async (post) => {
        const [{ count: likesCount }, { count: commentsCount }] =
          await Promise.all([
            supabase
              .from("likes")
              .select("*", { count: "exact", head: true })
              .eq("post_id", post.id),

            supabase
              .from("comments")
              .select("*", { count: "exact", head: true })
              .eq("post_id", post.id),
          ]);

        const views = Number(post.views_count || 0);
        const likes = Number(likesCount || 0);
        const comments = Number(commentsCount || 0);

        const engagementRate =
          views > 0 ? Number((((likes + comments) / views) * 100).toFixed(1)) : 0;

        const score = views + likes * 3 + comments * 5;

        return {
          id: post.id,
          content: post.content,
          created_at: post.created_at,
          views,
          likes,
          comments,
          engagementRate,
          score,
        };
      })
    );

    const totalPosts = analyzedPosts.length;
    const totalViews = analyzedPosts.reduce((sum, post) => sum + post.views, 0);
    const totalLikes = analyzedPosts.reduce((sum, post) => sum + post.likes, 0);
    const totalComments = analyzedPosts.reduce(
      (sum, post) => sum + post.comments,
      0
    );

    const averageEngagement =
      totalViews > 0
        ? Number((((totalLikes + totalComments) / totalViews) * 100).toFixed(1))
        : 0;

    const bestPost =
      analyzedPosts.length > 0
        ? [...analyzedPosts].sort((a, b) => b.score - a.score)[0]
        : null;

    let performance = "شروع مسیر";
    let suggestion = "چند پست منظم منتشر کن تا تحلیل دقیق‌تر شود.";

    if (totalPosts > 0) {
      if (averageEngagement >= 15) {
        performance = "عالی";
        suggestion = "تعامل پست‌ها خیلی خوب است. همین سبک محتوا را بیشتر ادامه بده.";
      } else if (averageEngagement >= 7) {
        performance = "خوب";
        suggestion = "عملکرد خوب است. برای رشد بیشتر، کپشن‌های تعاملی‌تر بنویس.";
      } else if (totalViews > 0 && averageEngagement < 7) {
        performance = "نیاز به بهبود";
        suggestion = "ویو داری ولی تعامل پایین است. سوال، نظرسنجی یا دعوت به کامنت اضافه کن.";
      }
    }

    res.json({
      user: {
        id: profileUser.id,
        username: profileUser.username,
        display_name: profileUser.display_name,
      },
      totalPosts,
      totalViews,
      totalLikes,
      totalComments,
      averageEngagement,
      performance,
      suggestion,
      bestPost,
    });
  } catch (err) {
    console.error("PROFILE PREMIUM ANALYTICS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
const canUsePremiumFeature = (user) => {
  const premiumActive =
    user.premium_plan === "silver" &&
    user.premium_until &&
    new Date(user.premium_until).getTime() > Date.now();

  return premiumActive || user.role === "admin";
};

app.get("/api/posts/:id/boost-preview", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id, user_id, content, views_count")
      .eq("id", id)
      .maybeSingle();

    if (postError) return res.status(500).json(postError);
    if (!post) return res.status(404).json({ error: "پست پیدا نشد" });

    const { data: user } = await supabase
      .from("users")
      .select("id, role, premium_plan, premium_until")
      .eq("id", req.user.id)
      .single();

    if (!canUsePremiumFeature(user)) {
      return res.status(403).json({
        error: "این قابلیت فقط برای کاربران پریمیوم و ادمین‌ها فعال است",
      });
    }

    const [{ count: likesCount }, { count: commentsCount }] =
      await Promise.all([
        supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", id),

        supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", id),
      ]);

    const views = Number(post.views_count || 0);
    const likes = Number(likesCount || 0);
    const comments = Number(commentsCount || 0);

    const estimatedMinViews = Math.max(
      80,
      Math.round(views * 0.35 + likes * 24 + comments * 35 + 120)
    );

    const estimatedMaxViews = Math.round(estimatedMinViews * 1.8);

    res.json({
      post_id: post.id,
      current: {
        views,
        likes,
        comments,
      },
      preview: {
        estimated_min_views: estimatedMinViews,
        estimated_max_views: estimatedMaxViews,
        expected_extra_likes: Math.max(5, Math.round(likes * 0.35 + 8)),
        expected_extra_comments: Math.max(1, Math.round(comments * 0.25 + 2)),
      },
      note: "این عدد تخمینی است و تضمینی نیست.",
    });
  } catch (err) {
    console.error("BOOST PREVIEW ERROR:", err);
    res.status(500).json({ error: "خطای سرور", details: err.message });
  }
});

app.post("/api/polls/create", auth, async (req, res) => {
  try {
    const {
      question,
      options,
      duration_hours,
      allow_multiple,
      show_results_after_vote,
    } = req.body;

    const { data: currentUser, error: currentUserError } = await supabase
      .from("users")
      .select("role, premium_plan, premium_until")
      .eq("id", req.user.id)
      .maybeSingle();

    if (currentUserError) {
      return res.status(500).json({
        error: "خطا در بررسی کاربر",
        details: currentUserError.message,
      });
    }

    const premiumActive =
      currentUser?.premium_plan === "silver" &&
      currentUser?.premium_until &&
      new Date(currentUser.premium_until).getTime() > Date.now();

    if (currentUser?.role !== "admin" && !premiumActive) {
      return res.status(403).json({
        error: "ساخت نظرسنجی فقط برای ادمین‌ها و کاربران پریمیوم فعال است",
      });
    }

    if (!question?.trim()) {
      return res.status(400).json({
        error: "متن سوال نظرسنجی الزامی است",
      });
    }

    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return res.status(400).json({
        error: "نظرسنجی باید بین ۲ تا ۶ گزینه داشته باشد",
      });
    }

    const cleanOptions = options
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    if (cleanOptions.length < 2) {
      return res.status(400).json({
        error: "حداقل ۲ گزینه معتبر وارد کنید",
      });
    }

    const durationHours = Math.min(
      Math.max(Number(duration_hours) || 24, 1),
      24 * 7
    );

    const closesAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert({
        user_id: req.user.id,
        content: question.trim(),
        post_type: "poll",
      })
      .select()
      .single();

    if (postError) {
      return res.status(500).json({
        error: "خطا در ساخت پست نظرسنجی",
        details: postError.message,
      });
    }

    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .insert({
        post_id: post.id,
        user_id: req.user.id,
        question: question.trim(),
        closes_at: closesAt.toISOString(),
        closed_at: null,
        allow_multiple: !!allow_multiple,
        show_results_after_vote: show_results_after_vote !== false,
      })
      .select()
      .single();

    if (pollError) {
      await supabase.from("posts").delete().eq("id", post.id);
      return res.status(500).json(pollError);
    }

    const { data: pollOptions, error: optionsError } = await supabase
      .from("poll_options")
      .insert(
        cleanOptions.map((optionText, index) => ({
          poll_id: poll.id,
          option_text: optionText,
          sort_order: index,
        }))
      )
      .select();

    if (optionsError) {
      await supabase.from("posts").delete().eq("id", post.id);
      return res.status(500).json(optionsError);
    }

    res.json({
      success: true,
      post,
      poll: {
        ...poll,
        options: pollOptions,
      },
    });
  } catch (err) {
    console.error("CREATE POLL ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});

app.get("/api/polls/post/:postId", auth, async (req, res) => {
  try {
    const { postId } = req.params;

    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .eq("post_id", postId)
      .maybeSingle();

    if (pollError) {
      return res.status(500).json({
        error: "خطا در دریافت نظرسنجی",
        details: pollError.message,
      });
    }

    if (!poll) {
      return res.status(404).json({
        error: "نظرسنجی پیدا نشد",
      });
    }

    const { data: options, error: optionsError } = await supabase
      .from("poll_options")
      .select("*")
      .eq("poll_id", poll.id)
      .order("sort_order", { ascending: true });

    if (optionsError) {
      return res.status(500).json({
        error: "خطا در دریافت گزینه‌ها",
        details: optionsError.message,
      });
    }

    const { data: myVotes, error: myVotesError } = await supabase
      .from("poll_votes")
      .select("option_id")
      .eq("poll_id", poll.id)
      .eq("user_id", req.user.id);

    if (myVotesError) {
      return res.status(500).json({
        error: "خطا در بررسی رای شما",
        details: myVotesError.message,
      });
    }

    const myVoteIds = (myVotes || []).map((item) => item.option_id);

    const totalVotes = (options || []).reduce(
      (sum, option) => sum + Number(option.votes_count || 0),
      0
    );

    const now = Date.now();
    const closesAtTime = poll.closes_at
      ? new Date(poll.closes_at).getTime()
      : null;

    const isClosed =
      !!poll.closed_at || (closesAtTime ? closesAtTime <= now : false);

    const resultsVisible =
      isClosed ||
      (poll.show_results_after_vote !== false && myVoteIds.length > 0);

    const maxVotes = Math.max(
      0,
      ...(options || []).map((option) => Number(option.votes_count || 0))
    );

    const finalOptions = (options || []).map((option) => {
      const votesCount = Number(option.votes_count || 0);

      const percent =
        totalVotes > 0 ? Math.round((votesCount / totalVotes) * 100) : 0;

      return {
        ...option,
        votes_count: resultsVisible ? votesCount : 0,
        percent: resultsVisible ? percent : 0,
        my_vote: myVoteIds.includes(option.id),
        is_winner:
          resultsVisible && totalVotes > 0 && votesCount === maxVotes,
      };
    });

    res.json({
      ...poll,
      options: finalOptions,
      total_votes: resultsVisible ? totalVotes : 0,
      real_total_votes: totalVotes,
      my_vote_option_id: myVoteIds[0] || null,
      my_vote_option_ids: myVoteIds,
      is_closed: isClosed,
      results_visible: resultsVisible,
      time_left_ms:
        !isClosed && closesAtTime ? Math.max(closesAtTime - now, 0) : 0,
    });
  } catch (err) {
    console.error("GET POLL ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/polls/:pollId/vote", auth, async (req, res) => {
  try {
    const { pollId } = req.params;
    const { option_id } = req.body;

    if (!option_id) {
      return res.status(400).json({
        error: "گزینه انتخاب نشده است",
      });
    }

    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .eq("id", pollId)
      .maybeSingle();

    if (pollError) {
      return res.status(500).json({
        error: "خطا در دریافت نظرسنجی",
        details: pollError.message,
      });
    }

    if (!poll) {
      return res.status(404).json({
        error: "نظرسنجی پیدا نشد",
      });
    }

    const now = Date.now();
    const closesAtTime = poll.closes_at
      ? new Date(poll.closes_at).getTime()
      : null;

    if (poll.closed_at || (closesAtTime && closesAtTime <= now)) {
      if (!poll.closed_at) {
        await supabase
          .from("polls")
          .update({ closed_at: new Date().toISOString() })
          .eq("id", pollId);
      }

      return res.status(400).json({
        error: "زمان این نظرسنجی تمام شده است",
      });
    }

    const { data: option, error: optionError } = await supabase
      .from("poll_options")
      .select("id, votes_count")
      .eq("id", option_id)
      .eq("poll_id", pollId)
      .maybeSingle();

    if (optionError) {
      return res.status(500).json({
        error: "خطا در بررسی گزینه",
        details: optionError.message,
      });
    }

    if (!option) {
      return res.status(404).json({
        error: "گزینه معتبر نیست",
      });
    }

    const { data: existingVote, error: existingVoteError } = await supabase
      .from("poll_votes")
      .select("id")
      .eq("poll_id", pollId)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (existingVoteError) {
      return res.status(500).json({
        error: "خطا در بررسی رای قبلی",
        details: existingVoteError.message,
      });
    }

    if (existingVote) {
      return res.status(409).json({
        error: "شما قبلاً در این نظرسنجی رای داده‌اید",
      });
    }

    const { error: voteError } = await supabase.from("poll_votes").insert({
      poll_id: Number(pollId),
      option_id: Number(option_id),
      user_id: req.user.id,
    });

    if (voteError) {
      return res.status(500).json({
        error: "خطا در ثبت رای",
        details: voteError.message,
      });
    }

    const { error: updateOptionError } = await supabase
      .from("poll_options")
      .update({
        votes_count: Number(option.votes_count || 0) + 1,
      })
      .eq("id", option_id);

    if (updateOptionError) {
      return res.status(500).json({
        error: "رای ثبت شد اما شمارنده گزینه آپدیت نشد",
        details: updateOptionError.message,
      });
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error("VOTE POLL ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/polls/:pollId/close", auth, async (req, res) => {
  try {
    const { pollId } = req.params;

    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("id, user_id, closed_at")
      .eq("id", pollId)
      .maybeSingle();

    if (pollError) {
      return res.status(500).json({
        error: "خطا در دریافت نظرسنجی",
        details: pollError.message,
      });
    }

    if (!poll) {
      return res.status(404).json({
        error: "نظرسنجی پیدا نشد",
      });
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", req.user.id)
      .maybeSingle();

    const isOwner = String(poll.user_id) === String(req.user.id);
    const isAdmin = currentUser?.role === "admin" || req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: "اجازه پایان دادن به این نظرسنجی را ندارید",
      });
    }

    if (poll.closed_at) {
      return res.json({
        success: true,
        already_closed: true,
      });
    }

    const { data, error } = await supabase
      .from("polls")
      .update({
        closed_at: new Date().toISOString(),
      })
      .eq("id", pollId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "خطا در پایان رأی‌گیری",
        details: error.message,
      });
    }

    res.json({
      success: true,
      poll: data,
    });
  } catch (err) {
    console.error("CLOSE POLL ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/admin/top-posts", auth, admin, async (req, res) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || "https://castle-x.vercel.app";

    const { data: topViewed } = await supabase
      .from("posts")
      .select(`
        id,
        content,
        views_count,
        created_at,
        author:users (
          username,
          display_name
        )
      `)
      .order("views_count", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: likes } = await supabase
      .from("likes")
      .select("post_id");

    const { data: comments } = await supabase
      .from("comments")
      .select("post_id");

    const countByPost = (items = []) => {
      const counts = {};

      items.forEach((item) => {
        if (!item.post_id) return;
        counts[item.post_id] = (counts[item.post_id] || 0) + 1;
      });

      const topId = Object.keys(counts).sort(
        (a, b) => counts[b] - counts[a]
      )[0];

      return {
        postId: topId,
        count: topId ? counts[topId] : 0,
      };
    };

    const topLikeInfo = countByPost(likes || []);
    const topCommentInfo = countByPost(comments || []);

    const getPost = async (postInfo) => {
      if (!postInfo.postId) return null;

      const { data } = await supabase
        .from("posts")
        .select(`
          id,
          content,
          views_count,
          created_at,
          author:users (
            username,
            display_name
          )
        `)
        .eq("id", postInfo.postId)
        .maybeSingle();

      if (!data) return null;

      return {
        ...data,
        count: postInfo.count,
        post_url: `${frontendUrl}/post/${data.id}`,
      };
    };

    res.json({
      top_viewed: topViewed
        ? {
            ...topViewed,
            count: topViewed.views_count || 0,
            post_url: `${frontendUrl}/post/${topViewed.id}`,
          }
        : null,

      top_liked: await getPost(topLikeInfo),
      top_commented: await getPost(topCommentInfo),
    });
  } catch (err) {
    console.error("ADMIN TOP POSTS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/admin/notifications/custom", auth, admin, async (req, res) => {
  try {
    const {
      title,
      message,
      target_type,
      usernames,
      notification_type,
    } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({
        error: "متن نوتیفیکیشن الزامی است",
      });
    }

    const type = notification_type?.trim() || "admin_custom";
    const targetType = target_type || "all";

    let query = supabase
      .from("users")
      .select("id, username, role, is_verified, premium_plan, premium_until, banned");

    if (targetType === "admins") {
      query = query.eq("role", "admin");
    }

    if (targetType === "verified") {
      query = query.eq("is_verified", true);
    }

    if (targetType === "premium") {
      query = query
        .eq("premium_plan", "silver")
        .gt("premium_until", new Date().toISOString());
    }

    if (targetType === "normal") {
      query = query
        .neq("role", "admin")
        .eq("is_verified", false)
        .or(`premium_plan.is.null,premium_until.lt.${new Date().toISOString()}`);
    }

    if (targetType === "specific") {
      const cleanUsernames = Array.isArray(usernames)
        ? usernames
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : String(usernames || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

      if (cleanUsernames.length === 0) {
        return res.status(400).json({
          error: "برای ارسال به افراد مشخص، حداقل یک نام کاربری وارد کنید",
        });
      }

      query = query.in("username", cleanUsernames);
    }

    query = query.neq("banned", true);

    const { data: users, error: usersError } = await query;

    if (usersError) {
      return res.status(500).json({
        error: "خطا در دریافت کاربران",
        details: usersError.message,
      });
    }

    if (!users || users.length === 0) {
      return res.status(404).json({
        error: "هیچ کاربری برای ارسال پیدا نشد",
      });
    }

    const notifications = users.map((user) => ({
      user_id: user.id,
      sender_id: req.user.id,
      type,
      title: title?.trim() || "Castle X",
      message: message.trim(),
      meta: {
        target_type: targetType,
        sent_by_admin_id: req.user.id,
      },
    }));

    const { error: insertError } = await supabase
      .from("notifications")
      .insert(notifications);

    if (insertError) {
      return res.status(500).json({
        error: "خطا در ارسال نوتیفیکیشن",
        details: insertError.message,
      });
    }

    res.json({
      success: true,
      sent_count: notifications.length,
    });
  } catch (err) {
    console.error("ADMIN CUSTOM NOTIFICATION ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.post("/api/admin/rankings/announce-weekly", auth, admin, async (req, res) => {
  try {
   const now = new Date();
const weekEnd = new Date(now.getTime());
const weekStart = await getRankingStartDate();
    const weekKey = `${weekStart.toISOString().slice(0, 10)}_${weekEnd
      .toISOString()
      .slice(0, 10)}`;

    const { data: alreadySent } = await supabase
      .from("notifications")
      .select("id")
      .eq("type", "weekly_ranking_result")
      .contains("meta", { week_key: weekKey })
      .limit(1)
      .maybeSingle();

    if (alreadySent) {
      return res.status(409).json({
        error: "نتایج این هفته قبلاً برای کاربران ارسال شده است",
      });
    }

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, user_id, content, views_count, created_at")
      .gte("created_at", weekStart.toISOString())
      .lte("created_at", weekEnd.toISOString())
      .limit(500);

    if (postsError) {
      return res.status(500).json({
        error: "خطا در دریافت پست‌ها",
        details: postsError.message,
      });
    }

    const usersScore = {};

    for (const post of posts || []) {
      const [{ count: likes }, { count: comments }, { count: reposts }] =
        await Promise.all([
          supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", post.id),
          supabase.from("comments").select("*", { count: "exact", head: true }).eq("post_id", post.id),
          supabase.from("reposts").select("*", { count: "exact", head: true }).eq("post_id", post.id),
        ]);

      const { data: author } = await supabase
        .from("users")
        .select("id, username, display_name, avatar_url, role, is_verified, premium_plan, premium_until")
        .eq("id", post.user_id)
        .maybeSingle();

      if (!author) continue;

      const score =
        Number(post.views_count || 0) +
        Number(likes || 0) * 4 +
        Number(comments || 0) * 6 +
        Number(reposts || 0) * 8;

      if (!usersScore[author.id]) {
        usersScore[author.id] = {
          user: author,
          score: 0,
        };
      }

      usersScore[author.id].score += score;
    }

    const winners = Object.values(usersScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item, index) => ({
        rank: index + 1,
        score: item.score,
        user: item.user,
      }));

    if (winners.length === 0) {
      return res.status(404).json({
        error: "برای این هفته رتبه‌ای پیدا نشد",
      });
    }

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, banned");

    if (usersError) {
      return res.status(500).json({
        error: "خطا در دریافت کاربران",
        details: usersError.message,
      });
    }

    const recipients = (users || []).filter((user) => user.banned !== true);

const notifications = recipients.map((user) => ({
  user_id: user.id,
  sender_id: req.user.id,
  type: "weekly_ranking_result",
  title: "برندگان هفته Castle X",
  message: "نتایج رتبه‌بندی این هفته اعلام شد",
  meta: {
    week_key: weekKey,
    winners,
  },
}));

const rankLabels = {
  1: "اول",
  2: "دوم",
  3: "سوم",
};

const winnerNotifications = winners.map((winner) => ({
  user_id: winner.user.id,
  sender_id: req.user.id,
  type: "weekly_winner",
  title: `تبریک ${winner.user.display_name || winner.user.username}`,
  message: `شما نفر ${rankLabels[winner.rank] || winner.rank} هفته Castle X شدید`,
  meta: {
    week_key: weekKey,
    rank: winner.rank,
    score: winner.score,
    winners,
  },
}));
const awardRows = winners.map((winner) => ({
  user_id: winner.user.id,
  rank: winner.rank,
  score: winner.score,
  week_key: weekKey,
}));

const { error: awardError } = await supabase
  .from("ranking_awards")
  .upsert(awardRows, {
    onConflict: "user_id,week_key",
  });

if (awardError) {
  return res.status(500).json({
    error: "خطا در ثبت افتخارات رتبه‌بندی",
    details: awardError.message,
  });
}
const allNotifications = [...notifications, ...winnerNotifications];

const { error: insertError } = await supabase
  .from("notifications")
  .insert(allNotifications);

    if (insertError) {
      return res.status(500).json({
        error: "خطا در ارسال نوتیفیکیشن",
        details: insertError.message,
      });
    }
    const nextRankingStartedAt = await resetRankingStartDate();

    res.json({
      success: true,
      sent_count: allNotifications.length,
      winners,
       next_ranking_started_at: nextRankingStartedAt,
    });
  } catch (err) {
    console.error("ANNOUNCE WEEKLY RANKING ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/admin/stats", auth, admin, async (req, res) => {
  try {
    const { count: users } = await supabase.from("users").select("*", {
      count: "exact",
      head: true,
    });

    const { count: posts } = await supabase.from("posts").select("*", {
      count: "exact",
      head: true,
    });

    const { count: comments } = await supabase.from("comments").select("*", {
      count: "exact",
      head: true,
    });

    const { count: likes } = await supabase.from("likes").select("*", {
      count: "exact",
      head: true,
    });

    res.json({
      users,
      posts,
      comments,
      likes,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/admin/ban/:id", auth, admin, async (req, res) => {
  try {
    const { data: targetUser, error: userError } =
      await supabase
        .from("users")
        .select("id, role")
        .eq("id", req.params.id)
        .single();

    if (userError) {
      return res.status(500).json(userError);
    }

    // هیچکس نمی‌تواند Founder را بن کند
    if (targetUser.role === "founder") {
      return res.status(403).json({
        error: "Founder account is protected",
      });
    }

    // فقط Founder می‌تواند Admin را بن کند
    if (
      targetUser.role === "admin" &&
      req.user.role !== "founder"
    ) {
      return res.status(403).json({
        error: "Only founder can ban admins",
      });
    }

    const { error } = await supabase
      .from("users")
      .update({
        banned: true,
      })
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.put("/api/admin/unban/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        banned: false,
      })
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.get("/api/admin/posts", auth, admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("posts")
      .select(
        `
            *,
            author:users(
              username,
              display_name
            )
          `,
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.delete("/api/admin/post/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.delete("/api/admin/comment/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.get("/api/admin/comments", auth, admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("comments")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.post("/api/reports", auth, async (req, res) => {
  try {
    console.log(req.body);
    console.log(req.user);

    const { target_user_id, post_id, reason } = req.body;

    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: req.user.id,
        target_user_id,
        post_id,
        reason,
      })
      .select();

    console.log(error);
    console.log(data);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.get("/api/admin/reports", auth, admin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.delete("/api/admin/report/:id", auth, admin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.get("/api/hashtags/trending", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 20);

    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, content, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json(error);
    }

    const counts = {};
    const latestTime = {};
    const hashtagRegex = /#([\p{L}\p{N}_]+)/gu;

    for (const post of posts || []) {
      const text = post.content || "";
      const seenInPost = new Set();
      let match;

      while ((match = hashtagRegex.exec(text)) !== null) {
        const tag = match[1].trim().toLowerCase();

        if (tag) {
          seenInPost.add(tag);
        }
      }

      for (const tag of seenInPost) {
        counts[tag] = (counts[tag] || 0) + 1;

        if (
          !latestTime[tag] ||
          new Date(post.created_at).getTime() > new Date(latestTime[tag]).getTime()
        ) {
          latestTime[tag] = post.created_at;
        }
      }
    }

    const trending = Object.entries(counts)
      .map(([tag, count]) => ({
        tag,
        count,
        latest_at: latestTime[tag],
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }

        return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
      })
      .slice(0, limit);

    res.json(trending);
  } catch (err) {
    console.error("TRENDING HASHTAGS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/hashtags/trending", auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, content, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      return res.status(500).json({
        error: "خطا در دریافت هشتگ‌های ترند",
        details: error.message,
      });
    }

    const hashtagMap = new Map();

    (posts || []).forEach((post) => {
      const matches = String(post.content || "").match(/#[\p{L}\p{N}_]+/gu);

      if (!matches) return;

      matches.forEach((tag) => {
        const cleanTag = tag.replace("#", "").toLowerCase();

        if (!cleanTag) return;

        const current = hashtagMap.get(cleanTag) || {
          tag: cleanTag,
          count: 0,
          latest_post_at: post.created_at,
        };

        current.count += 1;

        if (new Date(post.created_at) > new Date(current.latest_post_at)) {
          current.latest_post_at = post.created_at;
        }

        hashtagMap.set(cleanTag, current);
      });
    });

    const trending = [...hashtagMap.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;

        return new Date(b.latest_post_at) - new Date(a.latest_post_at);
      })
      .slice(0, limit);

    res.json(trending);
  } catch (err) {
    console.error("TRENDING HASHTAGS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/hashtags/:tag/posts", auth, async (req, res) => {
  try {
    const tag = decodeURIComponent(req.params.tag || "").replace("#", "").trim();

    if (!tag) {
      return res.status(400).json({ error: "هشتگ نامعتبر است" });
    }

    const limit = Math.min(Number(req.query.limit) || 15, 30);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: posts, error } = await supabase
      .from("posts")
      .select("*")
      .ilike("content", `%#${tag}%`)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      return res.status(500).json(error);
    }

    const result = await Promise.all(
      (posts || []).map(async (post) => {
        const { count: likesCount } = await supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { count: commentsCount } = await supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id);

        const { data: author } = await supabase
          .from("users")
          .select("id, username, display_name, avatar_url, role, is_verified, premium_until, premium_plan")
          .eq("id", post.user_id)
          .single();

        const { data: likeRow } = await supabase
          .from("likes")
          .select("id")
          .eq("post_id", post.id)
          .eq("user_id", req.user.id)
          .maybeSingle();
const { count: repostsCount } = await supabase
  .from("reposts")
  .select("*", {
    count: "exact",
    head: true,
  })
  .eq("post_id", post.id);

const { data: repostRow } = await supabase
  .from("reposts")
  .select("id")
  .eq("post_id", post.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
        return {
          ...post,
          author,
          likes_count:
            author?.role === "admin" ? (likesCount || 0) + 100 : likesCount || 0,
          comments_count: commentsCount || 0,
          reposts_count: repostsCount || 0,
          views_count:
            author?.role === "admin"
              ? (post.views_count || 0) + 200
              : post.views_count || 0,
          is_liked: !!likeRow,
          is_reposted: !!repostRow,
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error("HASHTAG POSTS ERROR:", err);

    res.status(500).json({
      error: "خطای سرور",
      details: err.message,
    });
  }
});
app.get("/api/posts/:id", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("posts")
    .select(`
      *,
      author:users (
        id,
        username,
        display_name,
        avatar_url,
        role,
        is_verified,
  premium_until,
  premium_plan
      )
    `)
    .eq("id", req.params.id)
    .single();

  if (error) {
    return res.status(404).json(error);
  }

  const responsePost = {
  ...data,
  views_count:
    data.author?.role === "admin"
      ? (data.views_count || 0) + 200
      : data.views_count || 0,
};
const { data: likeRow } = await supabase
  .from("likes")
  .select("id")
  .eq("post_id", data.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
const { count: repostsCount } = await supabase
  .from("reposts")
  .select("*", {
    count: "exact",
    head: true,
  })
  .eq("post_id", data.id);

const { data: repostRow } = await supabase
  .from("reposts")
  .select("id")
  .eq("post_id", data.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
  const { data: savedRow } = await supabase
  .from("saved_posts")
  .select("post_id")
  .eq("post_id", data.id)
  .eq("user_id", req.user.id)
  .maybeSingle();
responsePost.is_liked = !!likeRow;
responsePost.reposts_count = repostsCount || 0;
responsePost.is_reposted = !!repostRow;
responsePost.is_saved = !!savedRow;
res.json(responsePost);
});
app.delete("/api/comments/:id", auth, async (req, res) => {
  try {
    const commentId = req.params.id;

    const { data: comment } = await supabase
      .from("comments")
      .select("*")
      .eq("id", commentId)
      .single();

    if (!comment) {
      return res.status(404).json({
        error: "کامنت پیدا نشد",
      });
    }

    const { data: post } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", comment.post_id)
      .single();

    const isCommentOwner = String(comment.user_id) === String(req.user.id);
    const isPostOwner = String(post?.user_id) === String(req.user.id);

    if (!isCommentOwner && !isPostOwner) {
      return res.status(403).json({
        error: "اجازه حذف کامنت را ندارید",
      });
    }

    await supabase
      .from("comments")
      .delete()
      .eq("id", commentId);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.delete("/api/messages/:id", auth, async (req, res) => {
  try {
    const messageId = req.params.id;

    const { data: message } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (!message) {
      return res.status(404).json({
        error: "پیام پیدا نشد",
      });
    }

    if (String(message.sender_id) !== String(req.user.id)) {
      return res.status(403).json({
        error: "اجازه حذف پیام را ندارید",
      });
    }

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});
app.post("/api/upload/post-media", auth, upload.single("media"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
      });
    }

    const mimeType = req.file.mimetype || "";
    const isVideo = mimeType.startsWith("video");
    const bucket = isVideo ? "videos" : "posts";

    const originalName = req.file.originalname || "";
    const extension = originalName.includes(".")
      ? originalName.split(".").pop().toLowerCase()
      : mimeType.split("/")[1] || "jpg";

    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}.${extension}`;

    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, req.file.buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error("Upload error:", error);
      return res.status(500).json(error);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

    res.json({
      success: true,
      url: data.publicUrl,
      type: isVideo ? "video" : "image",
    });
  } catch (err) {
    console.error("Upload server error:", err);

    res.status(500).json({
      error: "Upload failed",
    });
  }
});
app.post("/api/upload/avatar", auth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
      });
    }

    const mimeType = req.file.mimetype || "";

    if (!mimeType.startsWith("image")) {
      return res.status(400).json({
        error: "Only image files are allowed",
      });
    }

    const originalName = req.file.originalname || "";
    const extension = originalName.includes(".")
      ? originalName.split(".").pop().toLowerCase()
      : mimeType.split("/")[1] || "jpg";

    const fileName = `${req.user.id}-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}.${extension}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(fileName, req.file.buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error("Avatar upload error:", error);
      return res.status(500).json(error);
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(fileName);

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        avatar_url: data.publicUrl,
      })
      .eq("id", req.user.id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json(updateError);
    }

    res.json({
      success: true,
      avatar_url: data.publicUrl,
      user: updatedUser,
    });
  } catch (err) {
    console.error("Avatar upload server error:", err);

    res.status(500).json({
      error: "Avatar upload failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Castle X running on port ${PORT}`);
});
