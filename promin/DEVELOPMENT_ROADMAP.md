# ProMin - Development Roadmap

**Version**: 2.0  
**Last Updated**: January 31, 2026  
**Planning Horizon**: 6-12 months

---

## 📋 Roadmap Overview

This document outlines the planned development phases for ProMin. Each phase builds upon the solid foundation established in Phases 1-7.

**Current Position**: All core features complete, ready for advanced enhancements

---

## 🎯 Phase 8: Reporting & Analytics Dashboard

**Priority**: 🔴 HIGH  
**Duration**: 2 weeks  
**Complexity**: ⭐⭐⭐ Medium  
**Dependencies**: None

### **Business Value**
- Give project managers visibility into project health
- Enable data-driven decision making
- Provide stakeholder reporting capabilities
- Track KPIs and progress trends

### **Features to Implement**

#### **8.1 Project Status Reports**
```
Components:
- ProjectStatusReport.tsx
- MilestoneSummaryReport.tsx
- TaskListReport.tsx

Features:
- Overall project health indicator
- Milestone completion timeline
- Task status breakdown
- Resource allocation summary
- Cost vs budget comparison
```

#### **8.2 Custom Dashboards**
```
Components:
- DashboardBuilder.tsx
- DashboardWidget.tsx
- WidgetLibrary.tsx

Features:
- Drag-and-drop widget placement
- Custom KPI cards (progress, cost, schedule)
- Chart widgets (bar, line, pie, donut)
- Saved dashboard configurations
- Dashboard sharing with team members
```

#### **8.3 Data Visualization**
```
Library: Recharts or Chart.js

Chart Types:
- Progress timeline (Gantt-style)
- Cost burn chart
- Resource utilization
- Milestone completion trend
- Task status pie chart
```

#### **8.4 Export Capabilities**
```
Features:
- PDF export for reports
- Excel export with formatting
- CSV data export
- Print-optimized views
```

### **Database Schema Changes**
```sql
-- Saved dashboards
CREATE TABLE dashboards (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  dashboard_name varchar(200) NOT NULL,
  widget_config jsonb NOT NULL, -- stores widget layout and settings
  is_shared boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Saved reports
CREATE TABLE saved_reports (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  report_name varchar(200) NOT NULL,
  report_type varchar(50) NOT NULL,
  filters jsonb,
  created_at timestamptz DEFAULT now()
);

-- RLS policies for both tables
-- (filter by project access through project_members)
```

### **Files to Create**
```
app/components/
  ├── reports/
  │   ├── ProjectStatusReport.tsx
  │   ├── MilestoneSummaryReport.tsx
  │   ├── TaskListReport.tsx
  │   ├── ReportExporter.tsx
  │   └── ReportFilters.tsx
  ├── dashboard/
  │   ├── Dashboard.tsx
  │   ├── DashboardBuilder.tsx
  │   ├── DashboardWidget.tsx
  │   ├── WidgetLibrary.tsx
  │   └── widgets/
  │       ├── ProgressWidget.tsx
  │       ├── CostWidget.tsx
  │       ├── ChartWidget.tsx
  │       └── KPICard.tsx
  └── charts/
      ├── BurnChart.tsx
      ├── ProgressChart.tsx
      └── StatusChart.tsx

app/lib/
  ├── reportGenerator.ts
  ├── pdfExport.ts
  └── chartData.ts
```

### **Testing Scenarios**
1. Create custom dashboard with 4 widgets
2. Save dashboard configuration
3. Load saved dashboard
4. Export project status report to PDF
5. Export task list to Excel
6. View progress trends over time
7. Share dashboard with team member

### **Success Criteria**
- ✅ Users can create custom dashboards
- ✅ Reports export correctly to PDF/Excel
- ✅ Charts update in real-time
- ✅ Dashboard configurations persist
- ✅ Performance remains fast (<2s load)

---

## 🎯 Phase 9: Advanced Scheduling (Gantt Chart)

**Priority**: 🔴 HIGH  
**Duration**: 3 weeks  
**Complexity**: ⭐⭐⭐⭐ High  
**Dependencies**: None

### **Business Value**
- Visual timeline planning
- Drag-and-drop rescheduling
- Better understanding of project timeline
- Industry-standard PM tool feature

### **Features to Implement**

#### **9.1 Horizontal Timeline View**
```
Component: GanttChart.tsx

Features:
- Tasks displayed on horizontal timeline
- Bars show task duration
- Lines show dependencies
- Current date indicator
- Zoom levels (day/week/month)
- Horizontal scrolling
```

#### **9.2 Drag-and-Drop Rescheduling**
```
Interactions:
- Drag task bar to move dates
- Resize bar to change duration
- Click and drag to create dependency
- Double-click to edit task details
```

#### **9.3 Critical Path Visualization**
```
Features:
- Critical path tasks highlighted (red)
- Non-critical tasks (blue)
- Float/slack shown for non-critical tasks
- Impact preview when dragging tasks
```

#### **9.4 Enhanced Dependency Types**
```
Currently: Only Finish-to-Start (FS)

Add:
- Start-to-Start (SS)
- Finish-to-Finish (FF)
- Start-to-Finish (SF)
- Lead/lag time
```

#### **9.5 Task Constraints**
```
Constraint Types:
- Must Start On (MSO)
- Must Finish On (MFO)
- Start No Earlier Than (SNET)
- Start No Later Than (SLAT)
- Finish No Earlier Than (FNET)
- Finish No Later Than (FLAT)
```

### **Database Schema Changes**
```sql
-- Enhanced dependency types
ALTER TABLE task_dependencies 
  ADD COLUMN dependency_type varchar(2) DEFAULT 'FS'
  CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF'));

ALTER TABLE task_dependencies 
  ADD COLUMN lag_days integer DEFAULT 0; -- can be negative (lead)

-- Task constraints
ALTER TABLE tasks 
  ADD COLUMN constraint_type varchar(20),
  ADD COLUMN constraint_date date;

-- Calendar exceptions (holidays, non-working days)
CREATE TABLE calendar_exceptions (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  exception_type varchar(20) NOT NULL, -- 'holiday', 'non_working', 'special'
  description varchar(200),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, exception_date)
);

-- Working calendar (default 5-day week)
CREATE TABLE project_calendars (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  monday_working boolean DEFAULT true,
  tuesday_working boolean DEFAULT true,
  wednesday_working boolean DEFAULT true,
  thursday_working boolean DEFAULT true,
  friday_working boolean DEFAULT true,
  saturday_working boolean DEFAULT false,
  sunday_working boolean DEFAULT false,
  hours_per_day integer DEFAULT 8,
  created_at timestamptz DEFAULT now()
);
```

### **Files to Create/Modify**
```
app/components/
  └── gantt/
      ├── GanttChart.tsx              [NEW]
      ├── GanttTimeline.tsx           [NEW]
      ├── GanttTaskBar.tsx            [NEW]
      ├── GanttDependencyLine.tsx     [NEW]
      └── GanttControls.tsx           [NEW]

app/lib/
  ├── dependencyScheduling.ts         [MODIFY - add new dependency types]
  ├── criticalPath.ts                 [MODIFY - add float calculation]
  ├── calendarCalculations.ts         [NEW]
  └── constraintValidator.ts          [NEW]

app/types/
  └── scheduling.ts                   [NEW]
```

### **Testing Scenarios**
1. Display tasks on Gantt timeline
2. Drag task to reschedule
3. Resize task to change duration
4. Create dependency by dragging
5. View critical path highlighting
6. Add task constraint (Must Start On)
7. Add calendar exception (holiday)
8. Verify working days respected
9. Test all dependency types (FS, SS, FF, SF)
10. Test lead/lag time

### **Success Criteria**
- ✅ Gantt chart renders all tasks correctly
- ✅ Drag-and-drop updates dates in database
- ✅ Critical path calculated and highlighted
- ✅ All 4 dependency types work
- ✅ Constraints enforced
- ✅ Calendar exceptions respected
- ✅ Performance good (100+ tasks)

---

## 🎯 Phase 10: Resource Management

**Priority**: 🟡 MEDIUM  
**Duration**: 2 weeks  
**Complexity**: ⭐⭐⭐ Medium  
**Dependencies**: Phase 9 (for capacity planning)

### **Business Value**
- Track team member availability
- Prevent over-allocation
- Balance workload across team
- Enable resource-based planning

### **Features to Implement**

#### **10.1 Resource Pool**
```
Component: ResourcePool.tsx

Features:
- Define team members with roles
- Set availability (full-time, part-time, % available)
- Define cost rates (hourly/daily)
- Set skills/capabilities
- Track vacation/time off
```

#### **10.2 Resource Allocation**
```
Component: ResourceAllocation.tsx

Features:
- Assign resources to tasks
- Set allocation percentage (25%, 50%, 100%)
- View resource workload
- Detect over-allocation
- Show availability calendar
```

#### **10.3 Resource Leveling**
```
Component: ResourceHistogram.tsx

Features:
- Histogram showing resource usage over time
- Over-allocation highlighted
- Automatic leveling suggestions
- Manual leveling controls
```

### **Database Schema Changes**
```sql
-- Resource pool
CREATE TABLE resources (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  role varchar(100),
  skills jsonb, -- array of skill names
  hourly_rate numeric(10,2),
  daily_rate numeric(10,2),
  max_hours_per_day integer DEFAULT 8,
  availability_percent integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Resource assignments
CREATE TABLE task_resource_assignments (
  id bigserial PRIMARY KEY,
  task_id bigint REFERENCES tasks(id) ON DELETE CASCADE,
  resource_id bigint REFERENCES resources(id) ON DELETE CASCADE,
  allocation_percent integer DEFAULT 100,
  hours_allocated numeric(10,2),
  assigned_at timestamptz DEFAULT now(),
  UNIQUE(task_id, resource_id)
);

-- Time off
CREATE TABLE resource_time_off (
  id bigserial PRIMARY KEY,
  resource_id bigint REFERENCES resources(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  time_off_type varchar(50), -- 'vacation', 'sick', 'personal'
  created_at timestamptz DEFAULT now()
);
```

### **Files to Create**
```
app/components/
  └── resources/
      ├── ResourcePool.tsx
      ├── ResourceAllocation.tsx
      ├── ResourceHistogram.tsx
      ├── ResourceCard.tsx
      └── TimeOffManager.tsx

app/lib/
  ├── resourceLeveling.ts
  ├── capacityCalculation.ts
  └── allocationValidator.ts
```

---

## 🎯 Phase 11: Cost Management & EVM

**Priority**: 🟡 MEDIUM  
**Duration**: 1-2 weeks  
**Complexity**: ⭐⭐ Low-Medium  
**Dependencies**: Phase 10 (for labor costs)

### **Business Value**
- Track project costs accurately
- Earned Value Management (EVM)
- Predict project completion costs
- Provide financial accountability

### **Features to Implement**

#### **11.1 Enhanced Cost Tracking**
```
Cost Categories:
- Labor costs (from resource assignments)
- Material costs
- Equipment costs
- Fixed costs
- Contingency reserves
```

#### **11.2 Earned Value Metrics**
```
Calculations:
- PV (Planned Value / BCWS)
- AC (Actual Cost / ACWP)
- EV (Earned Value / BCWP)
- CV (Cost Variance = EV - AC)
- SV (Schedule Variance = EV - PV)
- CPI (Cost Performance Index = EV / AC)
- SPI (Schedule Performance Index = EV / PV)
- EAC (Estimate at Completion)
- ETC (Estimate to Complete)
- VAC (Variance at Completion)
```

#### **11.3 Budget Baselines**
```
Features:
- Save project budget baseline
- Compare current vs baseline
- Track budget changes over time
- Variance analysis
```

### **Database Schema Changes**
```sql
-- Enhanced cost tracking
ALTER TABLE subtasks 
  ADD COLUMN labor_cost numeric(10,2) DEFAULT 0,
  ADD COLUMN material_cost numeric(10,2) DEFAULT 0,
  ADD COLUMN equipment_cost numeric(10,2) DEFAULT 0,
  ADD COLUMN fixed_cost numeric(10,2) DEFAULT 0;

-- Budget baselines
CREATE TABLE budget_baselines (
  id bigserial PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  baseline_name varchar(100) NOT NULL,
  baseline_date date NOT NULL,
  total_budget numeric(12,2) NOT NULL,
  baseline_data jsonb NOT NULL, -- snapshot of all costs
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Cost categories
CREATE TABLE cost_items (
  id bigserial PRIMARY KEY,
  entity_type varchar(50) NOT NULL, -- 'project', 'milestone', 'task', 'deliverable'
  entity_id bigint NOT NULL,
  cost_type varchar(50) NOT NULL, -- 'labor', 'material', 'equipment', 'fixed'
  description varchar(200),
  budgeted_amount numeric(10,2) DEFAULT 0,
  actual_amount numeric(10,2) DEFAULT 0,
  cost_date date,
  created_at timestamptz DEFAULT now()
);
```

---

## 🎯 Phase 12: Baseline & Version Control

**Priority**: 🟢 LOW-MEDIUM  
**Duration**: 1 week  
**Complexity**: ⭐⭐⭐ Medium  
**Dependencies**: Phase 11 (for cost baselines)

### **Features**

#### **12.1 Project Baselines**
- Save complete project state as baseline
- Multiple baselines per project (plan vs actual)
- Compare current state vs any baseline
- Variance analysis

#### **12.2 Change Tracking**
- Track all changes to tasks/dates/costs
- Change request workflow
- Approval process
- Change impact analysis

#### **12.3 Version History**
- Complete change log
- Rollback capability
- Diff view showing changes
- User attribution

---

## 🎯 Phase 13: Mobile Optimization

**Priority**: 🟡 MEDIUM  
**Duration**: 1-2 weeks  
**Complexity**: ⭐⭐ Low-Medium  
**Dependencies**: None

### **Features**

#### **13.1 Mobile-Responsive UI**
- Touch-optimized interactions
- Hamburger menu navigation
- Swipe gestures
- Mobile-optimized forms

#### **13.2 Progressive Web App**
- Add to home screen
- Offline functionality
- Background sync
- Push notifications

---

## 🎯 Phase 14: Integrations

**Priority**: 🟢 LOW  
**Duration**: 2-3 weeks  
**Complexity**: ⭐⭐⭐⭐ High  
**Dependencies**: None

### **Features**

#### **14.1 Calendar Sync**
- Google Calendar integration
- Outlook Calendar integration
- iCal export

#### **14.2 Communication**
- Slack notifications
- Microsoft Teams
- Email digests

#### **14.3 File Storage**
- Google Drive integration
- OneDrive integration
- Dropbox integration

---

## 🎯 Phase 15: AI-Powered Features

**Priority**: 🟢 LOW (Future)  
**Duration**: 3-4 weeks  
**Complexity**: ⭐⭐⭐⭐⭐ Very High  
**Dependencies**: All previous phases

### **Features**

#### **15.1 AI Task Estimation**
- Historical data analysis
- Similar task comparison
- Automatic duration estimation
- Risk prediction

#### **15.2 Smart Scheduling**
- ML-based optimization
- Resource allocation suggestions
- Bottleneck identification
- Predictive analytics

#### **15.3 Natural Language**
- "Create task for website redesign due Friday"
- "Show overdue tasks"
- "Reassign John's tasks to Sarah"

---

## 📊 Implementation Priority Matrix

| Phase | Priority | Complexity | Duration | Value | Score |
|-------|----------|------------|----------|-------|-------|
| 8 - Reporting | 🔴 HIGH | Medium | 2 weeks | HIGH | ⭐⭐⭐⭐⭐ |
| 9 - Gantt | 🔴 HIGH | High | 3 weeks | HIGH | ⭐⭐⭐⭐⭐ |
| 10 - Resources | 🟡 MEDIUM | Medium | 2 weeks | MEDIUM | ⭐⭐⭐⭐ |
| 11 - EVM | 🟡 MEDIUM | Low-Med | 1-2 weeks | MEDIUM | ⭐⭐⭐ |
| 12 - Baselines | 🟢 LOW-MED | Medium | 1 week | MEDIUM | ⭐⭐⭐ |
| 13 - Mobile | 🟡 MEDIUM | Low-Med | 1-2 weeks | HIGH | ⭐⭐⭐⭐ |
| 14 - Integrations | 🟢 LOW | High | 2-3 weeks | LOW | ⭐⭐ |
| 15 - AI | 🟢 LOW | Very High | 3-4 weeks | LOW | ⭐⭐ |

---

## 🎯 Recommended Implementation Order

### **Quarter 1** (Immediate - 0-3 months)
1. **Phase 8: Reporting & Analytics** (2 weeks)
   - Highest immediate value
   - Users need visibility NOW

2. **Phase 9: Advanced Scheduling / Gantt** (3 weeks)
   - Core feature enhancement
   - High user demand
   - Industry standard

### **Quarter 2** (3-6 months)
3. **Phase 10: Resource Management** (2 weeks)
   - Natural extension of scheduling
   - Enables capacity planning

4. **Phase 13: Mobile Optimization** (1-2 weeks)
   - Improve accessibility
   - Modern expectation

### **Quarter 3** (6-9 months)
5. **Phase 11: Cost Management / EVM** (1-2 weeks)
   - Financial tracking
   - Enterprise requirement

6. **Phase 12: Baselines & Version Control** (1 week)
   - Change management
   - Audit requirements

### **Quarter 4** (9-12 months)
7. **Phase 14: Integrations** (2-3 weeks)
   - Ecosystem connectivity
   - Enterprise sales requirement

8. **Phase 15: AI Features** (3-4 weeks)
   - Competitive differentiation
   - Future-proofing

---

## 🛠️ Development Process for Each Phase

### **Before Starting**
1. Review PROJECT_CONTEXT.md for current state
2. Create detailed technical specification
3. Design database schema changes
4. Create wireframes/mockups
5. Get stakeholder approval
6. Set up feature branch

### **During Development**
1. Follow existing architecture patterns
2. Maintain database-authoritative design
3. Write complete files (never patches)
4. Update type definitions
5. Test thoroughly
6. Document new features

### **After Completion**
1. Code review
2. Update PROJECT_CONTEXT.md
3. Deploy to staging
4. User acceptance testing
5. Deploy to production
6. Monitor for issues

---

## 📝 Success Metrics by Phase

### **Phase 8 (Reporting)**
- ✅ 5+ report types available
- ✅ Custom dashboards functional
- ✅ PDF/Excel export working
- ✅ Load time <2s

### **Phase 9 (Gantt)**
- ✅ Timeline renders correctly
- ✅ Drag-and-drop updates dates
- ✅ All 4 dependency types work
- ✅ Critical path accurate

### **Phase 10 (Resources)**
- ✅ Resource pool management
- ✅ Over-allocation detection
- ✅ Workload balancing
- ✅ Integration with costs

### **All Phases**
- Zero breaking changes to existing features
- Maintain <2s page load times
- All tests passing
- No security regressions
- Documentation updated

---

This roadmap is flexible and should be adjusted based on user feedback, business priorities, and technical discoveries during implementation.
