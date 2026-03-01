-- ============================================================================
-- Global Chat: Persistent conversation history
-- ============================================================================
-- Two tables for per-project, per-user chat conversations with messages.
-- RLS enforces that users only see their own conversations in projects
-- they are members of.
-- ============================================================================

-- 1. Conversations
CREATE TABLE public.chat_conversations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  title       text NOT NULL DEFAULT 'New conversation',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_chat_conversations_project_user
  ON public.chat_conversations(project_id, user_id, updated_at DESC);

-- 2. Messages
CREATE TABLE public.chat_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  entity_name     text,
  status          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_chat_messages_conversation
  ON public.chat_messages(conversation_id, created_at);

-- 3. Auto-touch updated_at on conversation when a message is inserted
CREATE OR REPLACE FUNCTION public.chat_conversation_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.chat_conversations
     SET updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_conversation_touch
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_conversation_touch();

-- 4. Limit enforcement triggers

-- Max 50 conversations per project per user
CREATE OR REPLACE FUNCTION public.chat_enforce_conversation_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.chat_conversations
  WHERE project_id = NEW.project_id AND user_id = NEW.user_id;

  IF v_count >= 50 THEN
    RAISE EXCEPTION 'Maximum 50 conversations per project reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_enforce_conversation_limit
  BEFORE INSERT ON public.chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_enforce_conversation_limit();

-- Max 200 messages per conversation
CREATE OR REPLACE FUNCTION public.chat_enforce_message_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.chat_messages
  WHERE conversation_id = NEW.conversation_id;

  IF v_count >= 200 THEN
    RAISE EXCEPTION 'Maximum 200 messages per conversation reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chat_enforce_message_limit
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_enforce_message_limit();

-- 5. RLS Policies

-- Conversations: user can see their own in projects they're a member of
CREATE POLICY "User can view own conversations"
  ON public.chat_conversations FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_project_member(project_id)
  );

CREATE POLICY "User can create conversations"
  ON public.chat_conversations FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_project_member(project_id)
  );

CREATE POLICY "User can update own conversations"
  ON public.chat_conversations FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "User can delete own conversations"
  ON public.chat_conversations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Messages: access via parent conversation ownership
CREATE POLICY "User can view messages in own conversations"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "User can insert messages in own conversations"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

-- Grant access
GRANT ALL ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_messages TO authenticated;
