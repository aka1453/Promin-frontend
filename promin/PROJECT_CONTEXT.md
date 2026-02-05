# ProMin - Project Management SaaS Platform

**Version**: 2.0  
**Last Updated**: January 31, 2026  
**Status**: Production-Ready Core, Enhancement Phase

---

## 🎯 Project Mission

ProMin is a production-ready project management SaaS application that combines MS Project-style dependency management with modern collaborative features. Built on Next.js and Supabase, it enforces a database-authoritative architecture where all business logic lives server-side.

---

## 🏗️ Core Architecture

### **Technology Stack**

**Frontend**
- Next.js 14 (App Router)
- TypeScript (strict mode)
- Tailwind CSS
- React hooks (functional components only)
- ReactFlow (workflow diagrams)
- lucide-react (icons)

**Backend**
- Supabase PostgreSQL (database)
- Supabase Realtime (live updates)
- Supabase Auth (authentication)
- Supabase Storage (file uploads)

**Development Environment**
- GitHub Codespaces
- Project Path: `/workspaces/Promin-frontend/promin/`
- Hot reload via Next.js dev server

### **Architectural Principles** (NON-NEGOTIABLE)

#### 1. **Database-Authoritative Design**
```
CLIENT                          SERVER (Supabase)
--------                        -----------------
Writes user intent   ────────>  Triggers calculate everything
Shows UI             <────────  Returns computed values
NO business logic               ALL business logic here
```

**Rules**:
- ✅ Client writes: "mark task complete"
- ✅ Server calculates: dates, progress, costs, rollups
- ❌ NEVER calculate on client
- ❌ NEVER trust client calculations

#### 2. **Bottom-Up Computation Model**
```
DELIVERABLES (leaf nodes)
    ↓ rollup
TASKS (sum/aggregate deliverables)
    ↓ rollup  
MILESTONES (aggregate tasks)
    ↓ rollup
PROJECTS (aggregate milestones)
```

**Flow**: Data flows upward automatically via database triggers

#### 3. **Zero-Trust Security**
- Every table has Row Level Security (RLS) policies
- Access controlled via `project_members` table
- No client-side permission checks
- All queries filtered by `auth.uid()` in RLS

#### 4. **Optimistic UI Updates**
```typescript
// Use useRef to track changes
const hasChangesRef = useRef(false);

// Update immediately
setData(newData);
hasChangesRef.current = true;

// Sync with server
await supabase.from('table').update(newData);
```

#### 5. **Lifecycle Immutability**
- Completed entities cannot be modified
- Enforced at database level
- Prevents data corruption
- Maintains audit trail

---

## 📊 Database Schema

### **Core Tables**

```sql
-- Projects (top level)
projects (
  id bigserial PRIMARY KEY,
  name varchar(200) NOT NULL,
  description text,
  status varchar(20) DEFAULT 'active',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  planned_progress numeric(5,4),
  actual_progress numeric(5,4),
  budgeted_cost numeric(12,2),
  actual_cost numeric(12,2),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Milestones
milestones (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text,
  weight numeric(5,4) DEFAULT 0, -- contribution to project
  status varchar(20) DEFAULT 'pending',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  planned_progress numeric(5,4),
  actual_progress numeric(5,4),
  budgeted_cost numeric(12,2),
  actual_cost numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Tasks
tasks (
  id bigserial PRIMARY KEY,
  milestone_id bigint REFERENCES milestones(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text,
  weight numeric(5,4) DEFAULT 0, -- contribution to milestone
  offset_days integer DEFAULT 0, -- CRITICAL: buffer before THIS task starts
  duration_days integer DEFAULT 1,
  status varchar(20) DEFAULT 'pending',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  planned_progress numeric(5,4),
  actual_progress numeric(5,4),
  budgeted_cost numeric(12,2),
  actual_cost numeric(12,2),
  position integer DEFAULT 0,
  assigned_to varchar(200),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- Task Dependencies (MS Project style)
task_dependencies (
  id bigserial PRIMARY KEY,
  task_id bigint REFERENCES tasks(id) ON DELETE CASCADE, -- successor
  depends_on_task_id bigint REFERENCES tasks(id) ON DELETE CASCADE, -- predecessor
  created_at timestamptz DEFAULT now(),
  UNIQUE(task_id, depends_on_task_id),
  CHECK (task_id != depends_on_task_id) -- prevent self-dependency
)

-- Deliverables (actual table is 'subtasks', exposed via VIEW)
subtasks (
  id bigserial PRIMARY KEY,
  task_id bigint REFERENCES tasks(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text,
  status varchar(20) DEFAULT 'pending',
  weight numeric(5,4) DEFAULT 0,
  duration_days integer NOT NULL DEFAULT 1, -- individual deliverable duration
  depends_on_deliverable_id bigint REFERENCES subtasks(id), -- parallel vs sequential
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  priority varchar(20),
  budgeted_cost numeric(10,2),
  actual_cost numeric(10,2),
  is_done boolean DEFAULT false,
  completed_at timestamptz,
  assigned_user_id uuid REFERENCES auth.users(id),
  assigned_by uuid REFERENCES auth.users(id),
  assigned_user varchar(200),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

-- CRITICAL: deliverables is a VIEW
CREATE VIEW deliverables AS SELECT * FROM subtasks;

-- Collaboration
comments (
  id bigserial PRIMARY KEY,
  entity_type varchar(50) NOT NULL, -- 'project', 'milestone', 'task', 'deliverable'
  entity_id bigint NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  comment_text text NOT NULL,
  parent_comment_id bigint REFERENCES comments(id), -- threading
  mentions jsonb, -- array of mentioned user_ids
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)

activities (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action_type varchar(50) NOT NULL,
  entity_type varchar(50),
  entity_id bigint,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
)

notifications (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  notification_type varchar(50) NOT NULL,
  title varchar(200),
  message text,
  entity_type varchar(50),
  entity_id bigint,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
)

project_members (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  role varchar(50) DEFAULT 'member', -- 'owner', 'admin', 'member'
  added_at timestamptz DEFAULT now(),
  added_by uuid REFERENCES auth.users(id),
  UNIQUE(project_id, user_id)
)
```

### **Key Database Behaviors**

**Automatic Rollups (via triggers)**:
- Deliverable changes → trigger task recalculation
- Task changes → trigger milestone recalculation  
- Milestone changes → trigger project recalculation

**Critical Path Algorithm**:
- Calculates longest path through task dependencies
- Updates planned_start/planned_end dates
- Cascades when dependencies change

**Offset Logic** (CRITICAL FIX - January 2026):
```sql
-- CORRECT: Offset belongs to the SUCCESSOR task
-- Task A (duration=1d) → Task B (offset=2d, duration=3d)
-- Result: Task B starts 2 days AFTER Task A ends

-- In dependencyScheduling.ts:
planned_start = predecessor.planned_end + predecessor.duration + THIS_TASK.offset
                                                                  ^^^^^^^^^^^^^^
                                                            (NOT predecessor.offset!)
```

---

## ✅ Completed Features

### **Phase 1-6: Core Platform** ✅

**Project Management**
- ✅ Full CRUD for Projects → Milestones → Tasks → Deliverables
- ✅ Hierarchical structure with proper cascading
- ✅ Weight-based progress calculation
- ✅ Cost tracking and rollups
- ✅ Status lifecycle management

**Task Dependencies (MS Project Style)**
- ✅ Finish-to-Start relationships
- ✅ Task offset support (buffer days)
- ✅ Critical path calculation
- ✅ Automatic date cascading
- ✅ Duration calculation from deliverables
- ✅ Dependency visualization (ReactFlow)
- ✅ Cycle detection

**Deliverable Management**
- ✅ Individual deliverable tracking
- ✅ Duration-based scheduling
- ✅ Sequential vs parallel work (dependencies)
- ✅ File uploads and management
- ✅ Completion tracking

**Collaboration**
- ✅ Threaded comments with @mentions
- ✅ Activity feed with real-time updates
- ✅ User assignments (projects/tasks/deliverables)
- ✅ Notification system (scheduled + real-time)

**Security**
- ✅ Row Level Security on all tables
- ✅ Project-based access control
- ✅ Lifecycle immutability enforcement
- ✅ CASCADE delete constraints

**UI/UX**
- ✅ Responsive grid layouts
- ✅ Card-based interfaces
- ✅ Workflow diagram (ReactFlow)
- ✅ Kanban board view
- ✅ Task details drawer
- ✅ Modern styling (Tailwind)

### **Phase 7: January 2026 Bug Fixes** ✅

**Issue #1**: Milestone delete button ✅
- Added delete option to MilestoneCard 3-dot menu
- Proper confirmation dialog
- CASCADE delete warning

**Issue #2**: Milestone weight field ✅
- Added weight input to EditMilestoneModal
- Validates 0-100 range
- Saves as decimal (0.0-1.0)

**Issue #3**: Offset calculation ✅ **CRITICAL**
- Fixed logic to use successor's offset, not predecessor's
- File: `app/lib/dependencyScheduling.ts`
- Impact: All task scheduling now correct

**Issue #4**: Kanban card collapse ✅
- Added ChevronUp/ChevronDown icons
- Collapse/expand with localStorage persistence
- Collapsed view shows title + progress
- File: `app/components/TaskCard.tsx`

**Issue #5**: Workflow state persistence ✅
- Tips panel remembers open/closed state
- Controls panel remembers open/closed state
- Uses localStorage with lazy initialization
- File: `app/components/TaskFlowDiagram.tsx`

**Issue #6**: Workflow task menu ✅
- Added 3-dot menu to expanded task cards
- Edit and Delete options
- Click-outside closes menu
- File: `app/components/TaskNode.tsx`

**Issue #7**: Duration display ✅
- Fixed table name: `deliverables` → `subtasks`
- Duration now loads correctly
- File: `app/components/TaskDetailsDrawer.tsx`

**Issue #8**: Upload button visibility ✅
- Moved upload button outside collapsible section
- Always visible without expanding
- File: `app/components/DeliverableCard.tsx`

**Issue #9**: Dependency badge ✅
- Fixed badge logic for independent vs sequential
- Proper null checks
- Clears state when dependency removed
- File: `app/components/DeliverableCard.tsx`

---

## 📁 File Structure

```
/workspaces/Promin-frontend/promin/
├── app/
│   ├── components/
│   │   ├── TaskCard.tsx              # Kanban cards (FIXED: collapse)
│   │   ├── TaskNode.tsx              # Workflow nodes (FIXED: menu)
│   │   ├── TaskFlowDiagram.tsx       # Workflow diagram (FIXED: persistence)
│   │   ├── TaskFlowBoard.tsx         # Kanban board
│   │   ├── TaskDetailsDrawer.tsx     # Task drawer (FIXED: table name)
│   │   ├── DeliverableCard.tsx       # Deliverable cards (FIXED: 3 issues)
│   │   ├── MilestoneCard.tsx         # Milestone cards (FIXED: delete)
│   │   ├── EditMilestoneModal.tsx    # Edit modal (FIXED: weight)
│   │   ├── AddTaskModal.tsx          # Create tasks
│   │   ├── EditTaskModal.tsx         # Edit tasks
│   │   ├── DeliverableCreateModal.tsx
│   │   ├── DeliverableInlineUploader.tsx
│   │   ├── DeliverableFileSection.tsx
│   │   ├── CommentSection.tsx
│   │   ├── ActivityFeed.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── dependencyScheduling.ts   # Task scheduling (FIXED: offset)
│   │   ├── lifecycle.ts              # Start/complete logic
│   │   ├── supabaseClient.ts         # Supabase connection
│   │   └── ...
│   ├── types/
│   │   ├── taskDependency.ts
│   │   └── ...
│   └── ...
└── ...
```

---

## 🎯 Development Principles

### **Code Quality Standards**

**TypeScript**
- Strict mode enabled
- Proper interfaces for all props
- Avoid `any` (use specific types)
- Export types for reuse

**React Patterns**
```typescript
// ✅ GOOD: Functional component with proper types
type Props = {
  task: Task;
  onUpdate: () => void;
};

export default function Component({ task, onUpdate }: Props) {
  const [state, setState] = useState<Type>(initialValue);
  
  useEffect(() => {
    // Load data
    return () => {
      // Cleanup
    };
  }, [dependencies]);
  
  return <div>{/* JSX */}</div>;
}

// ❌ BAD: Class components, any types, missing cleanup
```

**Database Operations**
```typescript
// ✅ GOOD: Proper error handling
try {
  const { data, error } = await supabase
    .from('table')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) throw error;
  
  // Use data
} catch (error) {
  console.error('Operation failed:', error);
  // Show user-friendly error
}

// ❌ BAD: No error handling, assumes success
```

**SQL Migrations**
```sql
-- ✅ GOOD: Idempotent operations
DROP TABLE IF EXISTS table_name CASCADE;
CREATE TABLE IF NOT EXISTS table_name (...);

DROP TRIGGER IF EXISTS trigger_name ON table_name;
CREATE TRIGGER trigger_name ...;

-- ❌ BAD: Will fail on re-run
CREATE TABLE table_name (...);
CREATE TRIGGER trigger_name ...;
```

### **Performance Best Practices**

**Database Queries**
- Select only needed columns
- Use indexes on foreign keys
- Avoid N+1 queries
- Use joins instead of multiple queries

**React Rendering**
- Memoize expensive calculations
- Use proper dependency arrays
- Avoid inline function definitions in JSX
- Use React.memo for pure components

**State Management**
- Keep state as local as possible
- Lift state only when necessary
- Use useRef for non-render values
- Batch state updates

---

## 🔐 Security Implementation

### **RLS Policy Pattern**

Every table has this structure:
```sql
-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users
DROP POLICY IF EXISTS "policy_name" ON table_name;

CREATE POLICY "policy_name" ON table_name
  FOR ALL
  TO authenticated
  USING (
    -- Check project access through project_members
    EXISTS (
      SELECT 1 FROM project_members pm
      INNER JOIN parent_table pt ON pt.id = table_name.parent_id
      WHERE pm.project_id = pt.project_id
      AND pm.user_id = auth.uid()
    )
  );
```

### **Access Control Flow**
```
User makes request
    ↓
Authenticated via JWT
    ↓
Query includes auth.uid()
    ↓
RLS policy checks project_members
    ↓
Returns only authorized rows
```

---

## 🚧 Known Limitations & Future Work

### **Current Limitations**

**Dependency Types**
- ✅ Finish-to-Start implemented
- ❌ Start-to-Start not yet supported
- ❌ Finish-to-Finish not yet supported
- ❌ Start-to-Finish not yet supported

**Resource Management**
- ❌ No resource allocation
- ❌ No over-allocation detection
- ❌ No resource leveling

**Reporting**
- ❌ Limited built-in reports
- ❌ No custom report builder
- ❌ No PDF export

**Calendar**
- ❌ No holiday/weekend handling
- ❌ No custom work calendars
- ❌ No resource calendars

**Mobile**
- ✅ Responsive design
- ⚠️ Not fully optimized for mobile
- ❌ No PWA features
- ❌ No offline mode

---

## 💾 Critical Code Patterns

### **Optimistic UI with useRef**
```typescript
export default function Component() {
  const hasChangesRef = useRef(false);
  const [data, setData] = useState<Type[]>([]);

  const handleUpdate = async (newData: Type) => {
    // Update UI immediately
    setData(current => current.map(item => 
      item.id === newData.id ? newData : item
    ));
    hasChangesRef.current = true;

    // Sync with server
    try {
      const { error } = await supabase
        .from('table')
        .update(newData)
        .eq('id', newData.id);

      if (error) throw error;
      
      hasChangesRef.current = false;
    } catch (error) {
      console.error('Update failed:', error);
      // Rollback or reload
    }
  };

  return <div>{/* ... */}</div>;
}
```

### **LocalStorage Persistence**
```typescript
// Lazy initialization
const [state, setState] = useState(() => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('key');
    return saved !== null ? JSON.parse(saved) : defaultValue;
  }
  return defaultValue;
});

// Save on change
useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('key', JSON.stringify(state));
  }
}, [state]);
```

### **Supabase Realtime**
```typescript
useEffect(() => {
  const subscription = supabase
    .channel('table_changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'table_name' },
      (payload) => {
        console.log('Change received:', payload);
        // Update state
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}, []);
```

---

## 📈 Success Metrics

**Technical Health**
- ✅ Zero TypeScript compilation errors
- ✅ All RLS policies properly configured
- ✅ No console errors in production
- ✅ All database constraints enforced
- ✅ Proper error handling throughout

**Functional Completeness**
- ✅ All CRUD operations working
- ✅ Dependencies calculating correctly
- ✅ Real-time updates functioning
- ✅ File uploads working
- ✅ Comments and @mentions working
- ✅ Notifications delivering

**User Experience**
- ✅ Responsive on all screen sizes
- ✅ Intuitive navigation
- ✅ Fast load times (<2s)
- ✅ Graceful error handling
- ✅ Clear feedback on actions

---

## 🎓 Key Learnings

1. **Database-First Architecture**
   - Moving business logic to database improves reliability
   - Triggers ensure data consistency automatically
   - RLS provides foolproof security

2. **Bottom-Up Computation**
   - Leaf-to-root calculation prevents inconsistencies
   - Automatic rollups eliminate manual sync
   - Single source of truth in database

3. **Offset Logic Critical**
   - Offset must belong to successor, not predecessor
   - This was Issue #3 - most critical fix
   - Affects all task scheduling

4. **Complete Files Over Patches**
   - Always provide full files, never snippets
   - Reduces errors and miscommunication
   - Easier to deploy and test

5. **LocalStorage Requires Lazy Init**
   - useState(() => ...) runs only once
   - Prevents hydration mismatches
   - Required for SSR with Next.js

---

## 🎯 Current Status Summary

**✅ Production-Ready**
- Core PM features complete
- Security properly implemented
- All critical bugs fixed
- Real-time collaboration working
- File management functional

**🚀 Ready for Enhancement**
- Solid foundation built
- Clean architecture established
- Extensible design patterns
- Well-documented codebase
- Ready for advanced features

**📊 Metrics**
- 9/9 bugs fixed (100%)
- 100% RLS coverage
- 0 TypeScript errors
- All features tested
- Production deployment ready

---

This document represents the complete authoritative state of ProMin as of January 31, 2026.
