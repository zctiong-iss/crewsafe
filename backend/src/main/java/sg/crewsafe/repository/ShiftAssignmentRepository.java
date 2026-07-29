package sg.crewsafe.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import sg.crewsafe.entity.ShiftAssignment;

import java.util.List;
import java.util.UUID;

@Repository
public interface ShiftAssignmentRepository extends JpaRepository<ShiftAssignment, UUID> {
    List<ShiftAssignment> findByShiftId(UUID shiftId);
    List<ShiftAssignment> findByWorkerId(UUID workerId);
}
