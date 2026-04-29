package com.pwbook.data.repository

import com.pwbook.data.local.dao.DomainAssocDao
import com.pwbook.data.local.entity.DomainAssocEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DomainAssocRepository @Inject constructor(
    private val domainAssocDao: DomainAssocDao
) {
    fun observeRules(userId: String): Flow<List<DomainAssocEntity>> = domainAssocDao.observeAll(userId)

    suspend fun getRules(userId: String): List<DomainAssocEntity> = domainAssocDao.getAll(userId)

    suspend fun saveRule(entity: DomainAssocEntity) = domainAssocDao.insert(entity)

    suspend fun saveRules(entities: List<DomainAssocEntity>) = domainAssocDao.insertAll(entities)

    suspend fun deleteRule(id: String) = domainAssocDao.deleteById(id)

    suspend fun clearUserRules(userId: String) = domainAssocDao.deleteAllByUser(userId)
}
